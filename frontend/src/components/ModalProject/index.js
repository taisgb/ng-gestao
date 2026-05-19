import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import './styles.scss';

export default function ModalProject({ isOpen, onClose, onSuccess }) {
  const [clients, setClients] = useState([]);
  const [formData, setFormData] = useState({
    client_id: '',
    title: '',
    description: '',
    base_value: '',
    payment_type: 'fixo', // Padrão MEI/Freelancer
    deadline: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Busca os clientes sempre que o modal abre para garantir que a lista esteja atualizada
  useEffect(() => {
    if (isOpen) {
      async function loadClients() {
        try {
          const response = await api.get('/clients');
          setClients(response.data);
        } catch (err) {
          setError('Não foi possível carregar a lista de clientes.');
        }
      }
      loadClients();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await api.post('/projects', formData);
      
      // Limpa o formulário
      setFormData({
        client_id: '',
        title: '',
        description: '',
        base_value: '',
        payment_type: 'fixo',
        deadline: ''
      });

      onSuccess(); // Recarrega a lista de projetos na página
      onClose();   // Fecha o modal
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar projeto.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <header>
          <h2>Iniciar Novo Projeto</h2>
          <button onClick={onClose} className="btn-close">×</button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Título do Projeto *</label>
            <input 
              required 
              placeholder="Ex: Identidade Visual - Café do Porto"
              value={formData.title}
              onChange={e => setFormData({...formData, title: e.target.value})}
            />
          </div>

          <div className="input-group">
            <label>Cliente *</label>
            <select 
              required
              value={formData.client_id}
              onChange={e => setFormData({...formData, client_id: e.target.value})}
            >
              <option value="">Selecione um parceiro</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>

          <div className="input-row">
            <div className="input-group">
              <label>Valor Estimado (R$)</label>
              <input 
                type="number"
                placeholder="0.00"
                value={formData.base_value}
                onChange={e => setFormData({...formData, base_value: e.target.value})}
              />
            </div>
            <div className="input-group">
              <label>Prazo de Entrega</label>
              <input 
                type="date"
                value={formData.deadline}
                onChange={e => setFormData({...formData, deadline: e.target.value})}
              />
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-cancel">Cancelar</button>
            <button type="submit" className="btn-save" disabled={isSubmitting}>
              {isSubmitting ? 'Criando...' : 'Confirmar Projeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}