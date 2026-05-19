import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import ModalProject from '../../components/ModalProject';
import './styles.scss';

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  async function loadProjects() {
    try {
      const response = await api.get('/projects');
      setProjects(response.data);
    } catch (err) {
      console.error("Erro ao carregar projetos", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  const isLimitReached = user?.plan === 'free' && projects.length >= 5;

  return (
    <div className="projects-container">
      <ModalProject 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={loadProjects} 
      />

      <header className="page-header">
        <h1>Projetos Ativos</h1>
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
            projects.map(project => (
              <div key={project.id} className="project-card">
                <div className="project-main-info">
                  <h3>{project.title}</h3>
                  <span className="client-tag">{project.client_name}</span>
                  {project.access_role !== 'owner' && <span className="shared-tag">Compartilhado</span>}
                </div>
                
                <div className="project-meta">
                  <div className="meta-item">
                    <span>Valor Base</span>
                    <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(project.base_value)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Prazo</span>
                    <strong>{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'Sem data'}</strong>
                  </div>
                  <div className={`status-badge ${project.status?.toLowerCase().replace(' ', '-')}`}>
                    {project.status}
                  </div>
                </div>
                {/* Botão atualizado para Link */}
                <Link to={`/projetos/${project.id}`} className="btn-manage">
                  Gerenciar
                </Link>
              </div>
            ))
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
