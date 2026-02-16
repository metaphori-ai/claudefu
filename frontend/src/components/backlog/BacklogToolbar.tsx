import { BacklogStatus, ALL_STATUSES, STATUS_CONFIG } from './types';

interface BacklogToolbarProps {
  statusFilter: BacklogStatus | 'all';
  onStatusFilterChange: (status: BacklogStatus | 'all') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
}

export function BacklogToolbar({
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  onAdd,
  onRefresh,
}: BacklogToolbarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      marginBottom: '1rem',
    }}>
      {/* Status filter dropdown */}
      <select
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value as BacklogStatus | 'all')}
        style={{
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '4px',
          color: '#ccc',
          padding: '0.35rem 0.5rem',
          fontSize: '0.8rem',
          cursor: 'pointer',
        }}
      >
        <option value="all">All</option>
        {ALL_STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
        ))}
      </select>

      {/* Search input */}
      <input
        type="text"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{
          flex: 1,
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '4px',
          color: '#ccc',
          padding: '0.35rem 0.5rem',
          fontSize: '0.8rem',
        }}
      />

      {/* Refresh button */}
      <button
        onClick={onRefresh}
        style={{
          background: 'none',
          border: '1px solid #333',
          borderRadius: '4px',
          color: '#666',
          padding: '0.35rem 0.5rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = '#555'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#333'; }}
        title="Refresh"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
      </button>

      {/* Add button */}
      <button
        onClick={onAdd}
        style={{
          background: '#d97757',
          border: 'none',
          borderRadius: '4px',
          color: '#fff',
          padding: '0.35rem 0.6rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#eb815e'}
        onMouseLeave={(e) => e.currentTarget.style.background = '#d97757'}
      >
        + Add
      </button>
    </div>
  );
}
