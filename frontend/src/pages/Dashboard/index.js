import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import './styles.scss'; 

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTasks() {
      try {
        const response = await api.get('/tasks/today');
        setTasks(response.data);
      } catch (error) {
        console.error("Erro ao buscar tarefas:", error);
      } finally {
        setLoading(false);
      }
    }
    loadTasks();
  }, []);

  async function handleCompleteTask(id) {
    try {
      await api.put(`/tasks/${id}`, { status: 'concluído' });
      // Remove a tarefa da tela instantaneamente para dar sensação de agilidade
      setTasks(tasks.filter(task => task.id !== id));
    } catch (error) {
      alert("Erro ao concluir a tarefa.");
    }
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <h1>Olá, {user?.name.split(' ')[0]}</h1>
          <p>Aqui estão os seus serviços para hoje.</p>
        </div>
        <button onClick={signOut} className="btn-logout">Sair</button>
      </header>

      {loading ? (
        <p className="loading-text">Carregando sua agenda...</p>
      ) : (
        <ul className="task-list">
          {tasks.length > 0 ? (
            tasks.map(task => (
              <li key={task.id} className={task.task_type}>
                <div className="task-info">
                  <strong>{task.title}</strong>
                  <span>{task.project_name || 'Sem projeto vinculado'} | {task.client_name || 'Sem cliente'}</span>
                </div>
                <button 
                  className="btn-complete"
                  onClick={() => handleCompleteTask(task.id)}
                  title="Marcar como concluído"
                >
                  ✓
                </button>
              </li>
            ))
          ) : (
            <div className="empty-state">
              <p>Tudo limpo por hoje! Aproveite para focar em outros projetos ou descansar.</p>
            </div>
          )}
        </ul>
      )}
    </div>
  );
}
