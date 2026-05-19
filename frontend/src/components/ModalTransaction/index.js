import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import './styles.scss';

export default function ModalTransaction({ isOpen, onClose, onSuccess }) {
  const [projects, setProjects] = useState([]);
  const [formData, setFormData] = useState({
    type: 'Receita',
    description: '',
    category: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    project_id: ''
  });

  useEffect(() => {
    if (isOpen) {
      api.get('/projects').then(res => setProjects(res.data));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await api.post('/transactions', {
        ...formData,
        amount: parseFloat(formData.amount)
      });
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || "Erro ao registrar lançamento");
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Novo Lançamento</h2>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Tipo</label>
            <select 
              value={formData.type} 
              onChange={e => setFormData({...formData, type: e.target.value})}
            >
              <option value="Receita">Receita (Entrada)</option>
              <option value="Despesa">Despesa (Saída)</option>
            </select>
          </div>

          <div className="input-group">
            <label>Descrição</label>
            <input 
              required 
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              placeholder="Ex: Pagamento Landing Page X"
            />
          </div>

          <div className="input-row">
            <div className="input-group">
              <label>Valor (R$)</label>
              <input 
                type="number" step="0.01" required
                value={formData.amount}
                onChange={e => setFormData({...formData, amount: e.target.value})}
              />
            </div>
            <div className="input-group">
              <label>Data</label>
              <input 
                type="date" required
                value={formData.date}
                onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>
          </div>

          <div className="input-group">
            <label>Categoria</label>
            <input
              required
              value={formData.category}
              onChange={e => setFormData({...formData, category: e.target.value})}
              placeholder="Ex: Hospedagem, entrada, fornecedor"
            />
          </div>

          <div className="input-group">
            <label>Vincular a um Projeto (Opcional)</label>
            <select 
              value={formData.project_id}
              onChange={e => setFormData({...formData, project_id: e.target.value})}
            >
              <option value="">Nenhum projeto</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-cancel">Cancelar</button>
            <button type="submit" className="btn-save">Confirmar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
