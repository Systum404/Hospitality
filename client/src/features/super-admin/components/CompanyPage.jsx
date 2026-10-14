import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { superAdminNavigationGroups, superAdminProfile } from "../superAdminConfig.js";

export function CompanyPage({ actions, children, description, title }) {
  return <AppShell navigationGroups={superAdminNavigationGroups} profile={superAdminProfile} title="Company Control Plane">
    <div className="company-page">
      <header className="company-page__header"><div><p className="eyebrow">Company / Super Admin</p><h2>{title}</h2><Breadcrumb />{description ? <p>{description}</p> : null}</div>{actions ? <div className="company-page__actions">{actions}</div> : null}</header>
      {children}
    </div>
  </AppShell>;
}
