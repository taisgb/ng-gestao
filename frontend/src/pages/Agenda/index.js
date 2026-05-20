import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

function isDoneStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'done' || normalized.startsWith('conclu');
}

function formatDate(date) {
  if (!date) return 'Sem prazo';
  return new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function Agenda() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  async function loadData() {
    try {
      const response = await api.get('/tasks?view=calendar');
      setTasks(response.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar calendario.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks.filter(task => {
      const isDone = isDoneStatus(task.status);
      const isTeamTask = Boolean(task.team_id || task.team_name);

      if (statusFilter === 'open' && isDone) return false;
      if (statusFilter === 'done' && !isDone) return false;
      if (scopeFilter === 'personal' && isTeamTask) return false;
      if (scopeFilter === 'team' && !isTeamTask) return false;
      return true;
    });
  }, [tasks, scopeFilter, statusFilter]);

  const groupedTasks = useMemo(() => {
    return visibleTasks.reduce((groups, task) => {
      const key = task.due_date || 'sem-data';
      return {
        ...groups,
        [key]: [...(groups[key] || []), task]
      };
    }, {});
  }, [visibleTasks]);

  async function handleStatus(task) {
    const nextStatus = isDoneStatus(task.status) ? 'pendente' : 'concluido';

    try {
      await api.put(`/tasks/${task.id}`, { status: nextStatus });
      await loadData();
      setFeedback('Tarefa atualizada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar tarefa.');
    }
  }

  return (
    <div className="agenda-container">
      <header className="page-header">
        <div>
          <h1>Calendario</h1>
          <p>Visualizacao das tarefas com prazo definido. Tarefas sem data ficam na tela Tarefas.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <div className="agenda-filters">
        <div>
          {[
            ['all', 'Todas'],
            ['personal', 'Individuais'],
            ['team', 'Equipe']
          ].map(([value, label]) => (
            <button
              key={value}
              className={scopeFilter === value ? 'active' : ''}
              onClick={() => setScopeFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          {[
            ['all', 'Todos os status'],
            ['open', 'Abertas'],
            ['done', 'Concluidas']
          ].map(([value, label]) => (
            <button
              key={value}
              className={statusFilter === value ? 'active' : ''}
              onClick={() => setStatusFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="loading-msg">Carregando calendario...</p>
      ) : (
        <section className="tasks-board">
          {Object.entries(groupedTasks).map(([date, dateTasks]) => (
            <div className="calendar-day" key={date}>
              <h2>{formatDate(date)}</h2>
              {dateTasks.map(task => {
                const isDone = isDoneStatus(task.status);

                return (
                  <article key={task.id} className={`task-card ${task.status}`}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.project_title || 'Sem projeto'} - {task.client_name || 'Sem cliente'}</span>
                      <div className="task-tags">
                        <small>{task.task_type || 'operational'}</small>
                        {task.team_name ? <small className="team-tag">Time: {task.team_name}</small> : <small>Individual</small>}
                      </div>
                    </div>
                    <div className="task-actions">
                      <button onClick={() => handleStatus(task)} type="button">
                        {isDone ? 'Reabrir' : 'Concluir'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ))}
          {visibleTasks.length === 0 && <p className="empty-msg">Nenhuma tarefa com prazo encontrada.</p>}
        </section>
      )}
    </div>
  );
}
