import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

export default function Services() {
  const [services, setServices] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState({ name: '', default_price: '', description: '' });

  async function loadServices() {
    try {
      const response = await api.get('/services');
      setServices(response.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar servicos.');
    }
  }

  useEffect(() => {
    loadServices();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/services', {
        ...form,
        default_price: Number(form.default_price || 0)
      });
      setForm({ name: '', default_price: '', description: '' });
      await loadServices();
      setFeedback('Servico cadastrado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao cadastrar servico.');
    }
  }

  async function handleArchive(id) {
    await api.delete(`/services/${id}`);
    await loadServices();
  }

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

  return (
    <div className="services-container">
      <header className="page-header">
        <div>
          <h1>Servicos</h1>
          <p>Catalogo de categorias que voce usa nos projetos e propostas.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="service-form">
        <form onSubmit={handleCreate}>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome do servico" required />
          <input type="number" step="0.01" value={form.default_price} onChange={e => setForm({ ...form, default_price: e.target.value })} placeholder="Valor padrao" />
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descricao curta" />
          <button type="submit">Adicionar</button>
        </form>
      </section>

      <section className="services-list">
        {services.map(service => (
          <article key={service.id} className="service-card">
            <div>
              <strong>{service.name}</strong>
              <p>{service.description || 'Sem descricao'}</p>
            </div>
            <div className="service-meta">
              <span>{formatCurrency(service.default_price)}</span>
              <button onClick={() => handleArchive(service.id)}>Arquivar</button>
            </div>
          </article>
        ))}
        {services.length === 0 && <p className="empty-msg">Nenhum servico cadastrado.</p>}
      </section>
    </div>
  );
}
