import type { Prisma, User } from '@prisma/client';
import { prisma } from '../client.js';

/**
 * Users are soft-deleted (PDPA 2022 retention rules apply before hard purge);
 * every read here filters deletedAt: null.
 */
export const userRepository = {
  findById(id: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  },

  findByPhone(phone: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { phone, deletedAt: null } });
  },

  create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },

  softDelete(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },
};
