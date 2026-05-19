import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [statusFilter, setStatusFilter] = useState('active');
  const [editingClient, setEditingClient] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [teams, setTeams] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientProjects, setClientProjects] = useState([]);
  const [clientDocuments, setClientDocuments] = useState([]);
  const [clientDocumentForm, setClientDocumentForm] = useState({
    file_name: '',
    file_url: '',
    provider: 'drive',
    document_type: 'contract',
    description: ''
  });
  const [projectFilter, setProjectFilter] = useState('all');
  const [feedback, setFeedback] = useState('');

  const loadClients = useCallback(async (status = statusFilter) => {
    try {
      const [clientsRes, teamsRes] = await Promise.all([
        api.get(`/clients?status=${status}`),
        api.get('/teams')
      ]);
      setClients(clientsRes.data);
      setTeams(teamsRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar clientes.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadClients(statusFilter);
  }, [loadClients, statusFilter]);

  const filteredClients = useMemo(() => {
    const term = search.toLowerCase();
    return clients.filter(client =>
      [client.name, client.contact_name, client.email, client.phone]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(term))
    );
  }, [clients, search]);

  const activeClientsCount = clients.filter(client => client.archived !== 1).length;
  const isLimitReached = user?.plan === 'free' && activeClientsCount >= 3;

  function startEdit(client) {
    setEditingClient(client);
    setEditForm({
      name: client.name || '',
      contact_name: client.contact_name || '',
      email: client.email || '',
      phone: client.phone || '',
      document: client.document || '',
      scope: client.team_id ? 'team' : 'individual',
      team_id: client.team_id || ''
    });
  }

  async function loadClientProjects(client) {
    setSelectedClient(client);
    try {
      const [projectsRes, documentsRes] = await Promise.all([
        api.get(`/clients/${client.id}/projects?include_archived=true`),
        api.get(`/clients/${client.id}/documents?status=all`)
      ]);
      setClientProjects(projectsRes.data);
      setClientDocuments(documentsRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar projetos do cliente.');
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.put(`/clients/${editingClient.id}`, {
        ...editForm,
        team_id: editForm.scope === 'team' ? editForm.team_id : null
      });
      setEditingClient(null);
      await loadClients();
      setFeedback('Cliente atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar cliente.');
    }
  }

  async function handleArchive(client) {
    setFeedback('');

    const confirmed = window.confirm('Deseja arquivar este cliente? Ele saira da lista principal, mas podera ser restaurado depois.');
    if (!confirmed) return;

    try {
      await api.patch(`/clients/${client.id}/archive`);
      if (selectedClient?.id === client.id) {
        setSelectedClient(current => current ? { ...current, archived: 1 } : current);
      }
      await loadClients();
      setFeedback('Cliente arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar cliente.');
    }
  }

  async function handleRestore(client) {
    setFeedback('');

    try {
      await api.patch(`/clients/${client.id}/restore`);
      if (selectedClient?.id === client.id) {
        setSelectedClient(current => current ? { ...current, archived: 0 } : current);
      }
      await loadClients();
      setFeedback('Cliente restaurado com sucesso.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar cliente.');
    }
  }

  async function handleCreateClientDocument(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/documents', {
        ...clientDocumentForm,
        client_id: selectedClient.id
      });
      setClientDocumentForm({
        file_name: '',
        file_url: '',
        provider: 'drive',
        document_type: 'contract',
        description: ''
      });
      await loadClientProjects(selectedClient);
      setFeedback('Documento do cliente cadastrado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao cadastrar documento do cliente.');
    }
  }

  async function handleArchiveClientDocument(document) {
    const confirmed = window.confirm('Deseja arquivar este documento? Ele podera ser restaurado depois.');
    if (!confirmed) return;

    try {
      await api.patch(`/documents/${document.id}/archive`);
      await loadClientProjects(selectedClient);
      setFeedback('Documento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar documento.');
    }
  }

  async function handleRestoreClientDocument(document) {
    try {
      await api.patch(`/documents/${document.id}/restore`);
      await loadClientProjects(selectedClient);
      setFeedback('Documento restaurado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar documento.');
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
          <p>{clients.length} cliente{clients.length === 1 ? '' : 's'} em {statusFilter === 'active' ? 'ativos' : statusFilter === 'archived' ? 'arquivados' : 'todos'}</p>
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
        <div className="status-tabs">
          {[
            ['active', 'Ativos'],
            ['archived', 'Arquivados'],
            ['all', 'Todos']
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? 'active' : ''}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
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
            <select value={editForm.scope} onChange={e => setEditForm({ ...editForm, scope: e.target.value, team_id: '' })}>
              <option value="individual">Individual</option>
              <option value="team">Compartilhado com time</option>
            </select>
            {editForm.scope === 'team' && (
              <select value={editForm.team_id} onChange={e => setEditForm({ ...editForm, team_id: e.target.value })} required>
                <option value="">Selecione o time</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            )}
            <button type="submit">Salvar alteracoes</button>
          </form>
        </section>
      )}

      {selectedClient && (
        <section className={`client-projects-panel ${selectedClient.archived === 1 ? 'archived' : ''}`}>
          <header>
            <div>
              <h2>Projetos de {selectedClient.name}</h2>
              <p>Projetos ativos e arquivados vinculados ao cliente.</p>
            </div>
            <div className="panel-actions">
              {selectedClient.archived === 1 && selectedClient.can_edit && (
                <button onClick={() => handleRestore(selectedClient)}>Restaurar cliente</button>
              )}
              <button onClick={() => setSelectedClient(null)}>Fechar</button>
            </div>
          </header>
          {selectedClient.archived === 1 && (
            <div className="archived-alert">Este cliente esta arquivado.</div>
          )}
          <div className="project-filter">
            {['all', 'active', 'archived'].map(filter => (
              <button
                key={filter}
                className={projectFilter === filter ? 'active' : ''}
                onClick={() => setProjectFilter(filter)}
              >
                {filter === 'all' ? 'Todos' : filter === 'active' ? 'Ativos' : 'Arquivados'}
              </button>
            ))}
          </div>
          <div className="client-projects-list">
            {clientProjects
              .filter(project => projectFilter === 'all' || (projectFilter === 'archived' ? project.archived === 1 : project.archived !== 1))
              .map(project => (
                <article key={project.id}>
                  <div>
                    <strong>{project.title}</strong>
                    <span>{project.status} {project.archived === 1 ? '- Arquivado' : ''}</span>
                  </div>
                  <div>
                    {project.can_view_financials && <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(project.base_value || 0))}</strong>}
                    {project.archived_at && <small>{new Date(project.archived_at).toLocaleDateString('pt-BR')}</small>}
                  </div>
                </article>
              ))}
            {clientProjects.length === 0 && <p className="empty-msg">Nenhum projeto vinculado.</p>}
          </div>

          <div className="client-documents-block">
            <h3>Documentos do Cliente</h3>
            {selectedClient.can_edit && (
              <form onSubmit={handleCreateClientDocument}>
                <input
                  value={clientDocumentForm.file_name}
                  onChange={e => setClientDocumentForm({ ...clientDocumentForm, file_name: e.target.value })}
                  placeholder="Nome do documento"
                  required
                />
                <input
                  value={clientDocumentForm.file_url}
                  onChange={e => setClientDocumentForm({ ...clientDocumentForm, file_url: e.target.value })}
                  placeholder="https://..."
                  required
                />
                <select value={clientDocumentForm.provider} onChange={e => setClientDocumentForm({ ...clientDocumentForm, provider: e.target.value })}>
                  <option value="drive">Drive</option>
                  <option value="external">Externo</option>
                  <option value="other">Outro</option>
                </select>
                <select value={clientDocumentForm.document_type} onChange={e => setClientDocumentForm({ ...clientDocumentForm, document_type: e.target.value })}>
                  <option value="contract">Contrato</option>
                  <option value="briefing">Briefing</option>
                  <option value="invoice">Nota fiscal</option>
                  <option value="receipt">Comprovante</option>
                  <option value="folder">Pasta</option>
                  <option value="other">Outro</option>
                </select>
                <input
                  value={clientDocumentForm.description}
                  onChange={e => setClientDocumentForm({ ...clientDocumentForm, description: e.target.value })}
                  placeholder="Descricao"
                />
                <button type="submit">Adicionar</button>
              </form>
            )}

            <div className="client-documents-list">
              {clientDocuments.map(document => (
                <article key={document.id} className={document.archived === 1 ? 'archived' : ''}>
                  <div>
                    <strong>{document.file_name}</strong>
                    <span>{document.document_type} - {document.provider}{document.archived === 1 ? ' - Arquivado' : ''}</span>
                  </div>
                  <div>
                    <a href={document.file_url} target="_blank" rel="noreferrer">Abrir</a>
                    {document.can_edit && document.archived !== 1 && <button onClick={() => handleArchiveClientDocument(document)}>Arquivar</button>}
                    {document.can_edit && document.archived === 1 && <button onClick={() => handleRestoreClientDocument(document)}>Restaurar</button>}
                  </div>
                </article>
              ))}
              {clientDocuments.length === 0 && <p className="empty-msg">Nenhum documento vinculado.</p>}
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <p className="loading-msg">Carregando clientes...</p>
      ) : (
        <div className="clients-grid">
          {filteredClients.map(client => (
            <article key={client.id} className={`client-card ${client.archived === 1 ? 'archived' : ''}`}>
              <div className="client-initials">{client.name.substring(0, 2).toUpperCase()}</div>
              <h3>{client.name}</h3>
              <p>{client.contact_name || 'Sem contato informado'}</p>
              <span>{client.email || client.phone || 'Sem canal informado'}</span>
              <small className="scope-badge">{client.team_id ? `Time: ${client.team_name}` : 'Individual'}</small>
              {client.archived === 1 && <small className="archived-badge">Arquivado</small>}
              <div className="card-actions">
                <button onClick={() => loadClientProjects(client)}>Projetos</button>
                {client.archived !== 1 && (client.can_edit ? <button onClick={() => startEdit(client)}>Editar</button> : <button disabled>Somente leitura</button>)}
                {client.can_edit && client.archived !== 1 && <button className="danger" onClick={() => handleArchive(client)}>Arquivar</button>}
                {client.can_edit && client.archived === 1 && <button className="restore" onClick={() => handleRestore(client)}>Restaurar</button>}
              </div>
            </article>
          ))}
          {filteredClients.length === 0 && <p className="empty-msg">Nenhum cliente encontrado.</p>}
        </div>
      )}
    </div>
  );
}
