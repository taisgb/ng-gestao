import React, { useEffect, useState } from 'react';
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
  ['completed', 'Concluidas'],
  ['week', 'Da semana'],
  ['financial_open', 'Financeiras abertas']
];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadDashboard() {
    try {
      const [tasksRes, summaryRes] = await Promise.all([
        api.get('/tasks/today'),
        api.get('/tasks/summary')
      ]);
      setTasks(tasksRes.data);
      setSummary(summaryRes.data);
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
      await api.put(`/tasks/${task.id}`, { status: isDone ? 'pendente' : 'concluido' });
      await loadDashboard();
    } catch (error) {
      alert('Erro ao atualizar a tarefa.');
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
                    </div>
                    <button
                      className="btn-complete"
                      onClick={() => handleCompleteTask(task)}
                      title={isDone ? 'Reabrir tarefa' : 'Marcar como concluida'}
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
      )}
    </div>
  );
}
