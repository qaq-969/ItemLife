import type { HouseholdDto, HouseholdInviteDto, HouseholdMemberDto } from '@itemlife/shared';
import { http, unwrap } from './http';

export const familyApi = {
  list: () => unwrap<HouseholdDto[]>(http.get('/households')),
  create: (name: string) => unwrap<HouseholdDto>(http.post('/households', { name })),
  join: (code: string) => unwrap<HouseholdDto>(http.post('/households/join', { code })),
  members: (id: string) => unwrap<HouseholdMemberDto[]>(http.get(`/households/${id}/members`)),
  leave: (id: string) => unwrap<null>(http.delete(`/households/${id}/members`)),
  removeMember: (id: string, userId: string) => unwrap<null>(http.delete(`/households/${id}/members/${userId}`)),
  invites: (id: string) => unwrap<HouseholdInviteDto[]>(http.get(`/households/${id}/invites`)),
  createInvite: (id: string, payload: { expiresInHours?: number; maxUses?: number } = {}) =>
    unwrap<HouseholdInviteDto>(http.post(`/households/${id}/invites`, payload)),
  revokeInvite: (id: string, inviteId: string) => unwrap<null>(http.delete(`/households/${id}/invites/${inviteId}`)),
};
