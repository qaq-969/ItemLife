import type { SiteAdminOverviewDto, SiteInviteDto, SiteRole, SiteStatusDto, SiteUserDto } from '@itemlife/shared';
import { http, unwrap } from './http';

export const siteAdminApi = {
  status: () => unwrap<SiteStatusDto>(http.get('/site/status')),
  overview: () => unwrap<SiteAdminOverviewDto>(http.get('/site/admin')),
  updateRegistration: (registrationOpen: boolean) =>
    unwrap<SiteStatusDto>(http.patch('/site/admin/registration', { registrationOpen })),
  createInvite: () => unwrap<SiteInviteDto>(http.post('/site/admin/invites')),
  revokeInvite: (id: string) => unwrap<null>(http.delete(`/site/admin/invites/${id}`)),
  updateRole: (id: string, role: Exclude<SiteRole, 'super_admin'>) =>
    unwrap<SiteUserDto>(http.patch(`/site/admin/users/${id}/role`, { role })),
  updateStatus: (id: string, enabled: boolean) =>
    unwrap<SiteUserDto>(http.patch(`/site/admin/users/${id}/status`, { enabled })),
};
