import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  MdDashboard, 
  MdPeople, 
  MdAssignment, 
  MdAttachMoney, 
  MdLogout,
  MdEventNote,
  MdHomeRepairService,
  MdAccountBalanceWallet,
  MdPerson,
  MdAdminPanelSettings,
  MdReceiptLong,
  MdDarkMode,
  MdLightMode
} from 'react-icons/md';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import './styles.scss';

export default function Sidebar() {
  const { signOut, user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const categoryLabel = {
    free: 'Plano Gratuito',
    pro: 'Assinante Pro',
    admin: 'Administrador',
    convidado: 'Convidado'
  };

  return (
    <aside className="sidebar-container">
      <div className="logo-section">
        <h2>Gestão NG</h2>
        {['pro', 'admin', 'convidado'].includes(user?.plan) && (
          <span className="badge-pro">{user?.plan === 'convidado' ? 'CONV' : user?.plan?.toUpperCase()}</span>
        )}
      </div>

      <nav className="menu-nav">
        <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdDashboard size={24} />
          <span>Início</span>
        </NavLink>

        <NavLink to="/clientes" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdPeople size={24} />
          <span>Clientes</span>
        </NavLink>

        <NavLink to="/projetos" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdAssignment size={24} />
          <span>Projetos</span>
        </NavLink>

        <NavLink to="/agenda" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdEventNote size={24} />
          <span>Agenda</span>
        </NavLink>

        <NavLink to="/financeiro" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdAttachMoney size={24} />
          <span>Caixa</span>
        </NavLink>

        <NavLink to="/financeiro-pessoal" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdAccountBalanceWallet size={24} />
          <span>Pessoal</span>
        </NavLink>

        <NavLink to="/notas-fiscais" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdReceiptLong size={24} />
          <span>NFs</span>
        </NavLink>

        <NavLink to="/servicos" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdHomeRepairService size={24} />
          <span>Servicos</span>
        </NavLink>

        <NavLink to="/perfil" className={({ isActive }) => isActive ? 'active' : ''}>
          <MdPerson size={24} />
          <span>Perfil</span>
        </NavLink>

        {user?.plan === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>
            <MdAdminPanelSettings size={24} />
            <span>Admin</span>
          </NavLink>
        )}
      </nav>

      <footer className="sidebar-footer">
        <div className="user-info">
          <strong>{user?.name.split(' ')[0]}</strong>
          <p>{categoryLabel[user?.plan] || 'Usuario'}</p>
        </div>
        <button onClick={toggleTheme} title={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}>
          {isDark ? <MdLightMode size={20} /> : <MdDarkMode size={20} />}
        </button>
        <button onClick={signOut} title="Sair do sistema">
          <MdLogout size={20} />
        </button>
      </footer>
    </aside>
  );
}
