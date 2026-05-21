import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import './styles.scss';

function isDoneStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'done' || normalized.startsWith('conclu');
}

const summaryCards = [
  ['pending', 'Tarefas pendentes'],
  ['overdue', 'Tarefas atrasadas'],
  ['completed', 'Concluídas'],
  ['week', 'Da semana'],
  ['financial_open', 'Financeiras abertas']
];

const priorityLabels = {
  low: 'Baixa',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente'
};

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [weekTasks, setWeekTasks] = useState([]);
  const [warrantyAlerts, setWarrantyAlerts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadDashboard() {
    try {
      const [tasksRes, summaryRes, weekRes, warrantyRes] = await Promise.all([
        api.get('/tasks/today'),
        api.get('/tasks/summary'),
        api.get('/tasks/week?limit=5'),
        api.get('/projects/warranty-alerts?days=15&limit=5')
      ]);
      setTasks(tasksRes.data);
      setSummary(summaryRes.data);
      setWeekTasks(Array.isArray(weekRes.data) ? weekRes.data : []);
      setWarrantyAlerts(Array.isArray(warrantyRes.data) ? warrantyRes.data : []);
    } catch (error) {
      console.error('Erro ao buscar tarefas:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleCompleteTask(task) {
    const isDone = isDoneStatus(task.status);

    try {
      await api.patch(`/tasks/${task.id}/status`, { status: isDone ? 'pending' : 'done' });
      await loadDashboard();
    } catch (error) {
      alert('Erro ao atualizar a tarefa.');
    }
  }

  async function handleCompleteWeekTask(task) {
    try {
      await api.patch(`/tasks/${task.id}/status`, { status: 'done' });
      await loadDashboard();
    } catch (error) {
      alert('Erro ao concluir a tarefa.');
    }
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <h1>Ola, {user?.name?.split(' ')[0]}</h1>
          <p>Resumo operacional das suas tarefas e prazos.</p>
        </div>
        <button onClick={signOut} className="btn-logout" type="button">Sair</button>
      </header>

      <section className="dashboard-task-summary">
        {summaryCards.map(([key, label]) => (
          <article key={key}>
            <span>{label}</span>
            <strong>{summary?.[key] || 0}</strong>
          </article>
        ))}
      </section>

      {loading ? (
        <p className="loading-text">Carregando tarefas...</p>
      ) : (
        <>
        <section className="dashboard-week-section">
          <div className="section-heading">
            <div>
              <h2 className="dashboard-section-title">Tarefas da semana</h2>
              <p>Prioridades com prazo nos próximos 7 dias.</p>
            </div>
            <Link to="/tarefas">Ver mais</Link>
          </div>

          <div className="week-task-grid">
            {weekTasks.length > 0 ? (
              weekTasks.map(task => (
                <article key={task.id} className={`week-task-card ${task.priority || 'medium'}`}>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.project_title || task.client_name || 'Sem projeto'}</span>
                  </div>
                  <div className="week-task-meta">
                    <span>{task.due_date ? new Date(task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Sem prazo'}</span>
                    <span>{priorityLabels[task.priority] || task.priority}</span>
                    <span>{task.assigned_name || 'Sem responsável'}</span>
                  </div>
                  <button type="button" onClick={() => handleCompleteWeekTask(task)}>
                    Concluir
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state compact">
                <p>Nenhuma tarefa com prazo para esta semana.</p>
              </div>
            )}
          </div>
        </section>

        <section className="dashboard-warranty-section">
          <div className="section-heading">
            <div>
              <h2 className="dashboard-section-title">Garantias de projetos</h2>
              <p>Projetos em garantia vencida ou vencendo nos próximos 15 dias.</p>
            </div>
          </div>

          <div className="warranty-alert-list">
            {warrantyAlerts.length > 0 ? (
              warrantyAlerts.map(project => (
                <Link
                  key={project.id}
                  to={`/projetos/${project.id}`}
                  className={`warranty-alert-card ${project.alert_level}`}
                >
                  <div>
                    <strong>{project.title}</strong>
                    <span>{project.client_name || 'Sem cliente'}{project.team_name ? ` | ${project.team_name}` : ''}</span>
                  </div>
                  <div className="warranty-alert-meta">
                    <span>
                      {project.warranty_end_date
                        ? new Date(project.warranty_end_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                        : 'Sem fim definido'}
                    </span>
                    <b>
                      {project.days_remaining < 0
                        ? `${Math.abs(project.days_remaining)} dia(s) vencida`
                        : `${project.days_remaining} dia(s) restantes`}
                    </b>
                  </div>
                </Link>
              ))
            ) : (
              <div className="empty-state compact">
                <p>Nenhuma garantia vencendo agora.</p>
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="dashboard-section-title">Hoje e atrasadas</h2>
          <ul className="task-list">
            {tasks.length > 0 ? (
              tasks.map(task => {
                const isDone = isDoneStatus(task.status);

                return (
                  <li key={task.id} className={task.task_type || 'operational'}>
                    <div className="task-info">
                      <strong>{task.title}</strong>
                      <span>
                        {task.project_title || 'Sem projeto'} | {task.client_name || 'Sem cliente'}
                      </span>
                      {task.due_date && (
                        <span>
                          Prazo: {new Date(task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                        </span>
                      )}
                    </div>
                    <button
                      className="btn-complete"
                      onClick={() => handleCompleteTask(task)}
                      title={isDone ? 'Reabrir tarefa' : 'Marcar como concluída'}
                      type="button"
                    >
                      {isDone ? 'Reabrir' : 'OK'}
                    </button>
                  </li>
                );
              })
            ) : (
              <div className="empty-state">
                <p>Tudo limpo por hoje. As tarefas sem prazo continuam disponiveis na tela Tarefas.</p>
              </div>
            )}
          </ul>
        </section>
        </>
      )}
    </div>
  );
}
