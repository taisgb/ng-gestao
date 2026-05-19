import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const DONE_STATUSES = ['concluido', 'concluído'];

export default function Agenda() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('open');
  const [form, setForm] = useState({
    title: '',
    due_date: new Date().toISOString().split('T')[0],
    task_type: 'execucao',
    project_id: '',
    team_id: ''
  });

  async function loadData() {
    try {
      const [tasksRes, projectsRes, teamsRes] = await Promise.all([
        api.get('/tasks'),
        api.get('/projects'),
        api.get('/teams')
      ]);
      setTasks(tasksRes.data);
      setProjects(projectsRes.data);
      setTeams(teamsRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar agenda.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks.filter(task => {
      const isDone = DONE_STATUSES.includes(task.status);
      const isTeamTask = Boolean(task.team_id || task.team_name);

      if (statusFilter === 'open' && isDone) return false;
      if (statusFilter === 'done' && !isDone) return false;
      if (scopeFilter === 'personal' && isTeamTask) return false;
      if (scopeFilter === 'team' && !isTeamTask) return false;
      return true;
    });
  }, [tasks, scopeFilter, statusFilter]);

  async function handleCreate(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/tasks', {
        ...form,
        project_id: form.project_id || null,
        team_id: form.project_id ? null : form.team_id || null
      });
      setForm({
        title: '',
        due_date: new Date().toISOString().split('T')[0],
        task_type: 'execucao',
        project_id: '',
        team_id: ''
      });
      await loadData();
      setFeedback('Tarefa criada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao criar tarefa.');
    }
  }

  async function handleStatus(task, status) {
    try {
      await api.put(`/tasks/${task.id}`, { status });
      await loadData();
      setFeedback('Tarefa atualizada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar tarefa.');
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/tasks/${id}`);
      await loadData();
      setFeedback('Tarefa excluida.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao excluir tarefa.');
    }
  }

  return (
    <div className="agenda-container">
      <header className="page-header">
        <div>
          <h1>Agenda</h1>
          <p>Tarefas individuais, avulsas de time e vinculadas aos projetos compartilhados.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="task-form-section">
        <form onSubmit={handleCreate}>
          <input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="Nome da tarefa"
            required
          />
          <select value={form.task_type} onChange={e => setForm({ ...form, task_type: e.target.value })}>
            <option value="execucao">Execucao</option>
            <option value="reuniao">Reuniao</option>
            <option value="entrega">Entrega</option>
            <option value="financeiro">Financeiro</option>
          </select>
          <input
            type="date"
            value={form.due_date}
            onChange={e => setForm({ ...form, due_date: e.target.value })}
            required
          />
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value, team_id: '' })}>
            <option value="">Sem projeto</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
          </select>
          <select
            value={form.team_id}
            onChange={e => setForm({ ...form, team_id: e.target.value })}
            disabled={Boolean(form.project_id)}
          >
            <option value="">Individual</option>
            {teams.map(team => (
              <option key={team.id} value={team.id}>Time: {team.name}</option>
            ))}
          </select>
          <button type="submit">Criar tarefa</button>
        </form>
      </section>

      <div className="agenda-filters">
        <div>
          {[
            ['all', 'Todas'],
            ['personal', 'Individuais'],
            ['team', 'Times']
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
            ['open', 'Abertas'],
            ['done', 'Concluidas'],
            ['all', 'Todos os status']
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
        <p className="loading-msg">Carregando agenda...</p>
      ) : (
        <section className="tasks-board">
          {visibleTasks.map(task => {
            const isDone = DONE_STATUSES.includes(task.status);
            return (
              <article key={task.id} className={`task-card ${task.status}`}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.project_title || 'Sem projeto'} - {new Date(task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
                  <div className="task-tags">
                    <small>{task.task_type}</small>
                    {task.team_name ? <small className="team-tag">Time: {task.team_name}</small> : <small>Individual</small>}
                  </div>
                </div>
                <div className="task-actions">
                  <button onClick={() => handleStatus(task, isDone ? 'pendente' : 'concluído')}>
                    {isDone ? 'Reabrir' : 'Concluir'}
                  </button>
                  <button className="danger" onClick={() => handleDelete(task.id)}>Excluir</button>
                </div>
              </article>
            );
          })}
          {visibleTasks.length === 0 && <p className="empty-msg">Nenhuma tarefa encontrada.</p>}
        </section>
      )}
    </div>
  );
}
