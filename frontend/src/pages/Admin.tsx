import { useEffect, useState } from 'react';
import { ROLE_LABEL, signOut, useStaffSession, type Role } from '../lib/api';
import { Brand } from '../components/ui';
import StaffLogin from '../components/StaffLogin';
import GameLinks from './admin/GameLinks';
import Overview from './admin/Overview';
import Participants from './admin/Participants';
import Scanner from './admin/Scanner';
import StaffManager from './admin/StaffManager';
import Questions from './admin/Questions';
import LiveMonitor from './admin/LiveMonitor';

type TabId = 'overview' | 'participants' | 'scan' | 'staff' | 'questions' | 'live';

// admin: management · quizmaster: questions · coordinator: conducts the event · volunteer: check-in + monitoring
const TABS: Record<Role, { id: TabId; label: string }[]> = {
  admin: [
    { id: 'overview', label: 'Overview' },
    { id: 'participants', label: 'Participants' },
    { id: 'scan', label: 'Check-in' },
    { id: 'staff', label: 'Staff' },
    { id: 'live', label: 'Live event' },
  ],
  quizmaster: [{ id: 'questions', label: 'Questions' }],
  coordinator: [{ id: 'live', label: 'Live event' }],
  volunteer: [
    { id: 'scan', label: 'Check-in' },
    { id: 'live', label: 'Live monitor' },
  ],
};

const TAB_KEY = 'techsprint_admin_tab';

export default function Admin() {
  const current = useStaffSession();
  const role = current?.staff.role;
  const tabs = role ? TABS[role] : [];
  const [tab, setTab] = useState<TabId>(() => {
    try { return (sessionStorage.getItem(TAB_KEY) as TabId) || 'overview'; } catch { return 'overview'; }
  });
  const active = tabs.find(t => t.id === tab) ? tab : tabs[0]?.id;

  useEffect(() => {
    try { if (active) sessionStorage.setItem(TAB_KEY, active); } catch { /* ignore */ }
  }, [active]);

  if (!current) return <StaffLogin />;

  return (
    <div className="stage">
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px clamp(16px, 3vw, 36px)', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <Brand />
        <span style={{ flex: 1 }} />
        <span className="pill pill-dark">{ROLE_LABEL[current.staff.role]}</span>
        <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{current.staff.displayName}</span>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
      </header>

      <main className="admin-main">
        {tabs.length > 1 && (
          <nav className="tabs" aria-label="Admin sections">
            {tabs.map(t => (
              <button key={t.id} className={`tab${t.id === active ? ' active' : ''}`} onClick={() => setTab(t.id)} aria-current={t.id === active ? 'page' : undefined}>
                {t.label}
              </button>
            ))}
          </nav>
        )}

        {active === 'overview' && <Overview />}
        {active === 'participants' && <Participants />}
        {active === 'scan' && <Scanner />}
        {active === 'staff' && <StaffManager />}
        {active === 'questions' && <Questions />}
        {active === 'live' && (
          <>
            {role !== 'volunteer' && <GameLinks />}
            <LiveMonitor />
          </>
        )}
      </main>
    </div>
  );
}
