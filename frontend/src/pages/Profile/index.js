import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { MdLocationOn, MdBusinessCenter } from 'react-icons/md';
import './styles.scss';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [stats, setStats] = useState({
    totalProjects: 0,
    recentTransactions: [],
    newProjects: []
  });
  const [profileForm, setProfileForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    role_title: user?.role_title || '',
    location: user?.location || '',
    bio: user?.bio || '',
    password: ''
  });
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfileData() {
      try {
        const [projectsRes, transRes] = await Promise.all([
          api.get('/projects'),
          api.get('/transactions')
        ]);

        setStats({
          totalProjects: projectsRes.data.length,
          newProjects: projectsRes.data.slice(0, 3),
          recentTransactions: transRes.data
            .filter(t => t.type === 'Receita')
            .slice(0, 4)
        });
      } catch (err) {
        setFeedback(err.response?.data?.error || 'Erro ao carregar dados do perfil.');
      } finally {
        setLoading(false);
      }
    }

    loadProfileData();
  }, []);

  async function handleUpdateProfile(e) {
    e.preventDefault();
    setFeedback('');

    try {
      const response = await api.put('/profile', {
        name: profileForm.name,
        email: profileForm.email,
        role_title: profileForm.role_title,
        location: profileForm.location,
        bio: profileForm.bio,
        ...(profileForm.password ? { password: profileForm.password } : {})
      });

      updateUser(response.data);
      setProfileForm(current => ({ ...current, password: '' }));
      setFeedback('Perfil atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar perfil.');
    }
  }

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  if (loading) {
    return (
      <div className="profile-loading">
        <p>Carregando seu perfil profissional...</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <section className="profile-header">
        <div className="avatar-big">
          {user?.name ? user.name.substring(0, 1).toUpperCase() : 'U'}
        </div>
        <div className="user-details">
          <h1>{user?.name}</h1>
          <div className="badges">
            <span><MdBusinessCenter /> {user?.role_title || 'Funcao nao informada'}</span>
            <span><MdLocationOn /> {user?.location || 'Local nao informado'}</span>
          </div>
          <p className="bio">{user?.bio || 'Bio profissional nao informada'}</p>
        </div>
        <div className="plan-tag">
          Plano {user?.plan?.toUpperCase()}
        </div>
      </section>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <div className="profile-grid">
        <div className="main-column">
          <div className="stats-row">
            <div className="stat-card">
              <strong>{stats.totalProjects}</strong>
              <span>Projetos Totais</span>
            </div>
            <div className="stat-card">
              <strong>{user?.plan === 'free' ? '5' : '∞'}</strong>
              <span>Limite de Projetos</span>
            </div>
          </div>

          <section className="section-block">
            <h2>Novos Projetos</h2>
            <div className="simple-list">
              {stats.newProjects.length > 0 ? (
                stats.newProjects.map(project => (
                  <div key={project.id} className="list-item">
                    <div>
                      <strong>{project.title}</strong>
                      <p>{project.client_name}</p>
                    </div>
                    <span className="date">
                      {project.deadline
                        ? new Date(project.deadline).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                        : 'Sem prazo'}
                    </span>
                  </div>
                ))
              ) : (
                <p className="empty">Nenhum projeto registrado.</p>
              )}
            </div>
          </section>
        </div>

        <div className="side-column">
          <section className="section-block receipts">
            <h2>Ultimos Recebimentos</h2>
            <div className="receipts-list">
              {stats.recentTransactions.length > 0 ? (
                stats.recentTransactions.map(t => (
                  <div key={t.id} className="receipt-item">
                    <div className="receipt-info">
                      <strong>{t.description}</strong>
                      <span>{new Date(t.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
                    </div>
                    <span className="value">{formatCurrency(t.amount)}</span>
                  </div>
                ))
              ) : (
                <p className="empty">Sem recebimentos recentes.</p>
              )}
            </div>
          </section>

          <section className="section-block profile-edit">
            <h2>Dados da conta</h2>
            <form onSubmit={handleUpdateProfile}>
              <label>Nome</label>
              <input
                value={profileForm.name}
                onChange={e => setProfileForm({ ...profileForm, name: e.target.value })}
                required
              />
              <label>Email</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={e => setProfileForm({ ...profileForm, email: e.target.value })}
                required
              />
              <label>Funcao na equipe</label>
              <input
                value={profileForm.role_title}
                onChange={e => setProfileForm({ ...profileForm, role_title: e.target.value })}
                placeholder="Ex: Financeiro, Designer, Desenvolvedor"
              />
              <label>Local</label>
              <input
                value={profileForm.location}
                onChange={e => setProfileForm({ ...profileForm, location: e.target.value })}
                placeholder="Cidade, UF"
              />
              <label>Bio profissional</label>
              <input
                value={profileForm.bio}
                onChange={e => setProfileForm({ ...profileForm, bio: e.target.value })}
                placeholder="Ex: Gestao financeira e notas fiscais"
              />
              <label>Nova senha</label>
              <input
                type="password"
                value={profileForm.password}
                minLength="8"
                onChange={e => setProfileForm({ ...profileForm, password: e.target.value })}
                placeholder="Opcional"
              />
              <button type="submit" className="btn-edit-profile">Salvar dados</button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
