import { type FormEvent, useState } from 'react';
import { SESSION_KEY } from './api';
import type { Tab } from './types';
import Concerns from './views/Concerns';
import CrewOffRequests from './views/CrewOffRequests';
import Export from './views/Export';
import Overview from './views/Overview';
import SupplyRequests from './views/SupplyRequests';
import Timesheet from './views/Timesheet';

type TabConfig = { id: Tab; label: string };

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'supply', label: 'Supply Requests' },
  { id: 'concerns', label: 'Concerns' },
  { id: 'crew-off', label: 'Crew-Off Requests' },
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'export', label: 'Export' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [authed, setAuthed] = useState<boolean>(() => sessionStorage.getItem(SESSION_KEY) === '1');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  const signOut = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setAuthed(false);
    setUsernameInput('');
    setPasswordInput('');
    setLoginError('');
  };

  if (!authed) {
    const handleLogin = (e: FormEvent) => {
      e.preventDefault();
      const expectedUser = (import.meta.env.VITE_ADMIN_USERNAME as string | undefined) ?? 'admin';
      const expectedPass =
        (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined) ?? 'password';
      if (usernameInput === expectedUser && passwordInput === expectedPass) {
        sessionStorage.setItem(SESSION_KEY, '1');
        setAuthed(true);
        setLoginError('');
      } else {
        setLoginError('Invalid username or password.');
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 w-full max-w-sm">
          <div className="text-center items-center justify-center flex flex-col">
            <h1 className="text-lg font-semibold text-gray-900 mb-1">🌲 Pinetree</h1>
            <p className="text-sm text-gray-500 mb-6">Sign in to continue.</p>
          </div>
          <form onSubmit={handleLogin}>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={usernameInput}
              onChange={(e) => {
                setUsernameInput(e.target.value);
                setLoginError('');
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 mb-3"
              placeholder="Username"
              autoComplete="username"
              autoFocus
            />
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setLoginError('');
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 mb-1"
              placeholder="Password"
              autoComplete="current-password"
            />
            {loginError && <p className="text-xs text-red-600 mt-1 mb-3">{loginError}</p>}
            <div className="mt-4">
              <button
                type="submit"
                disabled={!usernameInput.trim() || !passwordInput}
                className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                Sign in
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-6 h-14">
            <span className="text-sm font-semibold text-slate-100 shrink-0">🌲 Pinetree</span>
            <nav className="flex gap-1 flex-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                    tab === t.id
                      ? 'bg-white/20 text-white font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <button
              onClick={signOut}
              className="text-slate-400 hover:text-white text-sm transition-colors shrink-0"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'overview' && <Overview onTabChange={setTab} />}
        {tab === 'supply' && <SupplyRequests />}
        {tab === 'concerns' && <Concerns />}
        {tab === 'crew-off' && <CrewOffRequests />}
        {tab === 'timesheet' && <Timesheet />}
        {tab === 'export' && <Export />}
      </main>
    </div>
  );
}
