import { z } from 'zod';

export const ROLES = ['student', 'teacher', 'admin'] as const;

export const roleSchema = z.enum(ROLES);

export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  student: 'Student',
  teacher: 'Teacher',
  admin: 'Administrator',
};
