import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

export default function Agenda() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState({
    title: '',
    due_date: new Date().toISOString().split('T')[0],
    task_type: 'execucao',
    project_id: ''
  });

  async function loadData() {
    try {
      const [tasksRes, projectsRes] = await Promise.all([
        api.get('/tasks'),
        api.get('/projects')
      ]);
      setTasks(tasksRes.data);
      setProjects(projectsRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar agenda.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/tasks', {
        ...form,
        project_id: form.project_id || null
      });
      setForm({
        title: '',
        due_date: new Date().toISOString().split('T')[0],
        task_type: 'execucao',
        project_id: ''
      });
      await loadData();
      setFeedback('Tarefa criada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao criar tarefa.');
    }
  }

  async function handleStatus(task, status) {
    await api.put(`/tasks/${task.id}`, { status });
    await loadData();
  }

  async function handleDelete(id) {
    await api.delete(`/tasks/${id}`);
    await loadData();
  }

  return (
    <div className="agenda-container">
      <header className="page-header">
        <div>
          <h1>Agenda</h1>
          <p>Tarefas avulsas e vinculadas aos projetos compartilhados.</p>
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
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
            <option value="">Sem projeto</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
          </select>
          <button type="submit">Criar tarefa</button>
        </form>
      </section>

      {loading ? (
        <p className="loading-msg">Carregando agenda...</p>
      ) : (
        <section className="tasks-board">
          {tasks.map(task => (
            <article key={task.id} className={`task-card ${task.status}`}>
              <div>
                <strong>{task.title}</strong>
                <span>{task.project_title || 'Sem projeto'} - {new Date(task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
              </div>
              <div className="task-actions">
                <button onClick={() => handleStatus(task, task.status === 'concluído' ? 'pendente' : 'concluído')}>
                  {task.status === 'concluído' ? 'Reabrir' : 'Concluir'}
                </button>
                <button className="danger" onClick={() => handleDelete(task.id)}>Excluir</button>
              </div>
            </article>
          ))}
          {tasks.length === 0 && <p className="empty-msg">Nenhuma tarefa registrada.</p>}
        </section>
      )}
    </div>
  );
}
