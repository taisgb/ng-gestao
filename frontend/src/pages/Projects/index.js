import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import ModalProject from '../../components/ModalProject';
import './styles.scss';

const PROJECT_STATUS_META = {
  pendente: { label: 'Pendente', className: 'pending' },
  aprovado: { label: 'Aprovado', className: 'approved' },
  'em andamento': { label: 'Em andamento', className: 'in-progress' },
  done: { label: 'Concluído', className: 'done' },
  garantia: { label: 'Garantia', className: 'warranty' }
};

function getProjectStatusMeta(status) {
  const normalized = String(status || 'pendente').toLowerCase().trim();
  const normalizedKey = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalizedKey.startsWith('conclu')) return PROJECT_STATUS_META.done;
  return PROJECT_STATUS_META[normalized] || {
    label: status || 'Pendente',
    className: normalized.replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  };
}

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [feedback, setFeedback] = useState('');

  const loadProjects = useCallback(async (status = statusFilter, scope = scopeFilter) => {
    try {
      const params = new URLSearchParams({ status });
      if (scope !== 'all') params.set('scope', scope);
      const response = await api.get(`/projects?${params.toString()}`);
      setProjects(response.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar projetos.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, scopeFilter]);

  useEffect(() => {
    loadProjects(statusFilter, scopeFilter);
  }, [loadProjects, statusFilter, scopeFilter]);

  const activeProjectsCount = projects.filter(project => project.archived !== 1).length;
  const isLimitReached = user?.plan === 'free' && activeProjectsCount >= 5;

  async function handleArchive(project) {
    const confirmed = window.confirm('Deseja arquivar este projeto? Ele sairá da lista principal, mas poderá ser restaurado depois.');
    if (!confirmed) return;

    try {
      await api.patch(`/projects/${project.id}/archive`);
      await loadProjects();
      setFeedback('Projeto arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar projeto.');
    }
  }

  async function handleRestore(project) {
    try {
      await api.patch(`/projects/${project.id}/restore`);
      await loadProjects();
      setFeedback('Projeto restaurado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar projeto.');
    }
  }

  function canArchiveOrRestore(project) {
    return Boolean(project.can_edit || ['owner', 'admin', 'gestor'].includes(project.access_role));
  }

  return (
    <div className="projects-container">
      <ModalProject 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={loadProjects} 
      />

      <header className="page-header">
        <div>
          <h1>Projetos</h1>
          <p>{projects.length} projeto{projects.length === 1 ? '' : 's'} em {statusFilter === 'active' ? 'ativos' : statusFilter === 'archived' ? 'arquivados' : 'todos'}</p>
        </div>
        <button 
          className={`btn-add ${isLimitReached ? 'disabled' : ''}`}
          onClick={() => isLimitReached 
            ? alert("Limite de 5 projetos atingido no plano Free. Faça o upgrade!") 
            : setIsModalOpen(true)
          }
        >
          + Novo Projeto
        </button>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <div className="project-tabs">
        {[
          ['active', 'Ativos'],
          ['archived', 'Arquivados'],
          ['all', 'Todos']
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={statusFilter === value ? 'active' : ''}
            onClick={() => setStatusFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="project-tabs scope-tabs">
        {[
          ['all', 'Todos'],
          ['individual', 'Individuais'],
          ['team', 'De equipe']
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={scopeFilter === value ? 'active' : ''}
            onClick={() => setScopeFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Alerta de consistência com a página de Clientes */}
      {isLimitReached && (
        <div className="upgrade-alert">
          <p>Você atingiu o limite de 5 projetos do <strong>Plano Free</strong>.</p>
          <button onClick={() => window.location.href = '/upgrade'}>Liberar Projetos Ilimitados</button>
        </div>
      )}

      {loading ? (
        <p className="loading-msg">Organizando seus cronogramas...</p>
      ) : (
        <div className="projects-list">
          {projects.length > 0 ? (
            projects.map(project => {
              const statusMeta = getProjectStatusMeta(project.status);
              return (
              <div key={project.id} className={`project-card ${project.archived === 1 ? 'archived' : ''}`}>
                <div className="project-main-info">
                  <h3>{project.title}</h3>
                  <span className="client-tag">{project.client_name}</span>
                  <span className="scope-tag">{project.scope === 'team' ? `Time: ${project.team_name || 'Equipe'}` : 'Individual'}</span>
                  {project.scope === 'team' && project.access_role !== 'owner' && <span className="shared-tag">Compartilhado</span>}
                  {project.archived === 1 && <span className="archived-tag">Arquivado</span>}
                </div>
                
                <div className="project-meta">
                  <div className="meta-item">
                    <span>Valor Base</span>
                    <strong>{project.can_view_financials ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(project.base_value) : 'Restrito'}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Prazo</span>
                    <strong>{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'Sem data'}</strong>
                  </div>
                  <div className={`status-badge ${statusMeta.className}`}>
                    {statusMeta.label}
                  </div>
                </div>
                {/* Botão atualizado para Link */}
                <div className="project-actions">
                  <Link to={`/projetos/${project.id}`} className="btn-manage">
                    Gerenciar
                  </Link>
                  {canArchiveOrRestore(project) && project.archived !== 1 && (
                    <button className="btn-archive" onClick={() => handleArchive(project)}>Arquivar</button>
                  )}
                  {canArchiveOrRestore(project) && project.archived === 1 && (
                    <button className="btn-restore" onClick={() => handleRestore(project)}>Restaurar</button>
                  )}
                </div>
              </div>
              );
            })
          ) : (
            <div className="empty-state">
              <p>Nenhum projeto em andamento. Que tal prospectar novos clientes?</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
