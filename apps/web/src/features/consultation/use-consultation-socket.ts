'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import {
  chatReducer,
  initialChatState,
  type ChatState,
} from './chat-reducer';

interface TicketResponse {
  ticket: string;
}

/** ws:// for http://, wss:// for https:// — same host as the API. */
function socketUrl(ticket: string): string {
  const base = API_BASE_URL.replace(/^http/, 'ws');
  return `${base}/ws?ticket=${encodeURIComponent(ticket)}`;
}

export interface ConsultationSocket {
  state: ChatState;
  send: (body: string) => void;
  loadHistory: (
    messages: Array<{ id: string; senderUserId: string; body: string; sentAt: string }>,
  ) => void;
}

/**
 * WS chat + presence for one consultation.
 *
 * Auth is the 30-second single-use ticket from POST /ws/ticket — the JWT never
 * appears in a query string (CLAUDE.md). A closed socket reconnects with a
 * fresh ticket after a short backoff; an expired ticket is simply re-issued.
 */
export function useConsultationSocket(
  consultationId: string,
  selfUserId: string,
): ConsultationSocket {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const socketRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async (): Promise<void> => {
      if (closedRef.current) return;
      dispatch({ type: 'CONNECTION', state: 'connecting' });
      let ticket: string;
      try {
        ticket = (await api.post<TicketResponse>('/api/v1/ws/ticket')).ticket;
      } catch {
        dispatch({ type: 'CONNECTION', state: 'disconnected' });
        retryTimer = setTimeout(() => void connect(), 3000);
        return;
      }
      if (closedRef.current) return;

      const socket = new WebSocket(socketUrl(ticket));
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'join', consultationId }));
        dispatch({ type: 'CONNECTION', state: 'connected' });
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        let frame: { type?: string; [key: string]: unknown };
        try {
          frame = JSON.parse(event.data) as { type?: string };
        } catch {
          return;
        }
        if (frame.type === 'chat.message') {
          dispatch({
            type: 'INBOUND_MESSAGE',
            messageId: frame['messageId'] as string,
            senderUserId: frame['senderUserId'] as string,
            body: frame['body'] as string,
            sentAt: frame['sentAt'] as string,
            selfUserId,
          });
        } else if (frame.type === 'participant.joined') {
          dispatch({ type: 'PEER_JOINED', userId: frame['userId'] as string, selfUserId });
        } else if (frame.type === 'participant.left') {
          dispatch({ type: 'PEER_LEFT', userId: frame['userId'] as string });
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (closedRef.current) return;
        dispatch({ type: 'CONNECTION', state: 'disconnected' });
        retryTimer = setTimeout(() => void connect(), 2000);
      };
    };

    void connect();

    return () => {
      closedRef.current = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [consultationId, selfUserId]);

  const send = useCallback(
    (body: string) => {
      const key = `local-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
      dispatch({
        type: 'OPTIMISTIC_SEND',
        key,
        body,
        selfUserId,
        sentAt: new Date().toISOString(),
      });
      const socket = socketRef.current;
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        dispatch({ type: 'SEND_FAILED', key });
        return;
      }
      try {
        socket.send(JSON.stringify({ type: 'chat.message', consultationId, body }));
      } catch {
        dispatch({ type: 'SEND_FAILED', key });
      }
    },
    [consultationId, selfUserId],
  );

  const loadHistory = useCallback(
    (messages: Array<{ id: string; senderUserId: string; body: string; sentAt: string }>) => {
      dispatch({ type: 'HISTORY_LOADED', messages, selfUserId });
    },
    [selfUserId],
  );

  return { state, send, loadHistory };
}
