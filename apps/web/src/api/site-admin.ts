import type { SiteAdminOverviewDto, SiteInviteDto, SiteRole, SiteStatusDto, SiteUserDto } from '@itemlife/shared';
import { http, unwrap } from './http';

export const siteAdminApi = {
  status: () => unwrap<SiteStatusDto>(http.get('/site/status')),
  overview: () => unwrap<SiteAdminOverviewDto>(http.get('/site/admin')),
  updateRegistration: (registrationOpen: boolean) =>
    unwrap<SiteStatusDto>(http.patch('/site/admin/registration', { registrationOpen })),
  createInvite: (remark: string) => unwrap<SiteInviteDto>(http.post('/site/admin/invites', { remark: remark.trim() || undefined })),
  revokeInvite: (id: string) => unwrap<null>(http.delete(`/site/admin/invites/${id}`)),
  updateRole: (id: string, role: Exclude<SiteRole, 'super_admin'>) =>
    unwrap<SiteUserDto>(http.patch(`/site/admin/users/${id}/role`, { role })),
  updateStatus: (id: string, enabled: boolean) =>
    unwrap<SiteUserDto>(http.patch(`/site/admin/users/${id}/status`, { enabled })),
  resetPassword: (id: string, password: string) =>
    unwrap<null>(http.patch(`/site/admin/users/${id}/password`, { password })),
  deleteUser: (id: string) => unwrap<null>(http.delete(`/site/admin/users/${id}`)),
};
