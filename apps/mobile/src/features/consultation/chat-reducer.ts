/**
 * Consultation chat state — pure and testable. Outbound messages render
 * optimistically (pending → confirmed | failed); inbound WS frames and the
 * loaded history merge by server message id, so an echo of our own send
 * reconciles with the optimistic bubble instead of duplicating it.
 */
export interface ChatEntry {
  /** Optimistic client id until the server assigns one. */
  key: string;
  /** Server message id once known (from history or the WS echo). */
  serverId: string | null;
  senderUserId: string;
  body: string;
  sentAt: string;
  status: 'pending' | 'confirmed' | 'failed';
  mine: boolean;
}

export interface ChatState {
  entries: ChatEntry[];
}

export const initialChatState: ChatState = { entries: [] };

export type ChatAction =
  | { type: 'HISTORY_LOADED'; messages: Array<{ id: string; senderUserId: string; body: string; sentAt: string }>; selfUserId: string }
  | { type: 'OPTIMISTIC_SEND'; key: string; body: string; selfUserId: string; sentAt: string }
  | { type: 'SEND_FAILED'; key: string }
  | {
      type: 'INBOUND_MESSAGE';
      messageId: string;
      senderUserId: string;
      body: string;
      sentAt: string;
      selfUserId: string;
    };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'HISTORY_LOADED':
      return {
        entries: action.messages.map((message) => ({
          key: message.id,
          serverId: message.id,
          senderUserId: message.senderUserId,
          body: message.body,
          sentAt: message.sentAt,
          status: 'confirmed',
          mine: message.senderUserId === action.selfUserId,
        })),
      };

    case 'OPTIMISTIC_SEND':
      return {
        entries: [
          ...state.entries,
          {
            key: action.key,
            serverId: null,
            senderUserId: action.selfUserId,
            body: action.body,
            sentAt: action.sentAt,
            status: 'pending',
            mine: true,
          },
        ],
      };

    case 'SEND_FAILED':
      return {
        entries: state.entries.map((entry) =>
          entry.key === action.key ? { ...entry, status: 'failed' } : entry,
        ),
      };

    case 'INBOUND_MESSAGE': {
      // Already have this server id? Ignore (idempotent WS delivery).
      if (state.entries.some((entry) => entry.serverId === action.messageId)) return state;

      const mine = action.senderUserId === action.selfUserId;
      if (mine) {
        // Reconcile the oldest still-pending optimistic bubble of ours.
        const pendingIndex = state.entries.findIndex(
          (entry) => entry.mine && entry.status === 'pending' && entry.body === action.body,
        );
        if (pendingIndex !== -1) {
          const entries = [...state.entries];
          entries[pendingIndex] = {
            ...entries[pendingIndex]!,
            serverId: action.messageId,
            sentAt: action.sentAt,
            status: 'confirmed',
          };
          return { entries };
        }
      }
      return {
        entries: [
          ...state.entries,
          {
            key: action.messageId,
            serverId: action.messageId,
            senderUserId: action.senderUserId,
            body: action.body,
            sentAt: action.sentAt,
            status: 'confirmed',
            mine,
          },
        ],
      };
    }

    default:
      return state;
  }
}
