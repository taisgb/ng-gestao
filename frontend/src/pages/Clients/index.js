import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import ModalClient from '../../components/ModalClient';
import './styles.scss';

export default function Clients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editingClient, setEditingClient] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [feedback, setFeedback] = useState('');

  async function loadClients() {
    try {
      const response = await api.get('/clients');
      setClients(response.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar clientes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  const filteredClients = useMemo(() => {
    const term = search.toLowerCase();
    return clients.filter(client =>
      [client.name, client.contact_name, client.email, client.phone]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(term))
    );
  }, [clients, search]);

  const isLimitReached = user?.plan === 'free' && clients.length >= 3;

  function startEdit(client) {
    setEditingClient(client);
    setEditForm({
      name: client.name || '',
      contact_name: client.contact_name || '',
      email: client.email || '',
      phone: client.phone || '',
      document: client.document || ''
    });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.put(`/clients/${editingClient.id}`, editForm);
      setEditingClient(null);
      await loadClients();
      setFeedback('Cliente atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar cliente.');
    }
  }

  async function handleArchive(id) {
    setFeedback('');

    try {
      await api.delete(`/clients/${id}`);
      await loadClients();
      setFeedback('Cliente arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar cliente.');
    }
  }

  return (
    <div className="clients-container">
      <ModalClient
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={loadClients}
      />

      <header className="page-header">
        <div>
          <h1>Clientes</h1>
          <p>{clients.length} cliente{clients.length === 1 ? '' : 's'} ativo{clients.length === 1 ? '' : 's'}</p>
        </div>
        <button
          className={`btn-add ${isLimitReached ? 'disabled' : ''}`}
          onClick={() => isLimitReached ? navigate('/upgrade') : setIsModalOpen(true)}
        >
          Novo Cliente
        </button>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      {isLimitReached && (
        <div className="upgrade-alert">
          <p>Voce atingiu o limite de 3 clientes do Plano Free.</p>
          <button onClick={() => navigate('/upgrade')}>Fazer upgrade</button>
        </div>
      )}

      <div className="toolbar">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, contato, email ou telefone"
        />
      </div>

      {editingClient && (
        <section className="edit-panel">
          <header>
            <h2>Editar cliente</h2>
            <button onClick={() => setEditingClient(null)}>Fechar</button>
          </header>
          <form onSubmit={handleSaveEdit}>
            <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} placeholder="Nome / Empresa" required />
            <input value={editForm.contact_name} onChange={e => setEditForm({ ...editForm, contact_name: e.target.value })} placeholder="Pessoa de contato" />
            <input value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} placeholder="Email" />
            <input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Telefone" />
            <input value={editForm.document} onChange={e => setEditForm({ ...editForm, document: e.target.value })} placeholder="CPF / CNPJ" />
            <button type="submit">Salvar alteracoes</button>
          </form>
        </section>
      )}

      {loading ? (
        <p className="loading-msg">Carregando clientes...</p>
      ) : (
        <div className="clients-grid">
          {filteredClients.map(client => (
            <article key={client.id} className="client-card">
              <div className="client-initials">{client.name.substring(0, 2).toUpperCase()}</div>
              <h3>{client.name}</h3>
              <p>{client.contact_name || 'Sem contato informado'}</p>
              <span>{client.email || client.phone || 'Sem canal informado'}</span>
              <div className="card-actions">
                <button onClick={() => startEdit(client)}>Editar</button>
                <button className="danger" onClick={() => handleArchive(client.id)}>Arquivar</button>
              </div>
            </article>
          ))}
          {filteredClients.length === 0 && <p className="empty-msg">Nenhum cliente encontrado.</p>}
        </div>
      )}
    </div>
  );
}
