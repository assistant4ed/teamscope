import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Users, RefreshCw, MoreHorizontal, Flag,
  Calendar, Trash2, AlertTriangle, Check, ImagePlus, Loader2,
  Folder, Share2, Link as LinkIcon, FolderPlus, Pencil,
} from 'lucide-react';
import { apiGet, apiFetch, Me } from '../auth';

// Single source of truth for "where are we — logged-in app, public view-only
// link, or public edit-mode link?" Every API call routes through helpers
// that consult this so a public visitor doesn't accidentally hit authed
// endpoints (and so authed code keeps working unchanged).
export type ApiCtx =
  | { kind: 'authed' }
  | { kind: 'public-view'; token: string }
  | { kind: 'public-edit'; token: string };

const ApiContext = createContext<ApiCtx>({ kind: 'authed' });
const useApiCtx = () => useContext(ApiContext);

function urlBoard(ctx: ApiCtx, boardId?: string): string {
  if (ctx.kind === 'authed') {
    return boardId ? `/api/kanban/board?board_id=${encodeURIComponent(boardId)}` : '/api/kanban/board';
  }
  return `/api/public/board/${ctx.token}`;
}
function urlCardsBase(ctx: ApiCtx): string {
  return ctx.kind === 'authed' ? '/api/kanban/cards' : `/api/public/board/${ctx.token}/cards`;
}
function urlUpload(ctx: ApiCtx): string {
  return ctx.kind === 'authed' ? '/api/uploads/image' : `/api/public/board/${ctx.token}/uploads/image`;
}

// ---------- Types ---------------------------------------------------- //
interface Column {
  id: string; name: string; position: number;
  is_done: boolean; wip_limit: number | null;
}
interface Card {
  id: string; column_id: string; title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  position: number;
  due_date: string | null;
  created_by: string; created_at: string; updated_at: string;
  done_at: string | null;
  source_kind: string; source_ref: string | null;
  image_urls: string[];
}
interface Assignee { card_id: string; subscriber_id: string; assigned_at: string }
interface Subscriber {
  id: string; name: string; role: string | null;
  timezone: string; telegram_chat_id: number; active: boolean;
}

interface BoardData {
  columns: Column[]; cards: Card[];
  assignees: Assignee[]; subscribers: Subscriber[];
  board_id?: string;
  board?: { id: string; name: string; share_mode: 'view' | 'edit' };
}

interface BoardSummary {
  id: string; name: string; is_default: boolean;
  share_enabled: boolean; share_mode: 'view' | 'edit';
  share_token: string | null;
}

type ViewMode = 'columns' | 'swimlanes';

// ---------- Main component ------------------------------------------ //
// `apiCtx` defaults to authed when rendered from Shell. PublicBoard
// passes a token-based ctx so the same rendering tree fetches and
// mutates against /api/public/board/:token/* instead.
export default function Board({ me, apiCtx = { kind: 'authed' } }: {
  me: Me; apiCtx?: ApiCtx;
}) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('columns');
  const [filterSub, setFilterSub] = useState<string | null>(null);
  const [addToCol, setAddToCol] = useState<string | null>(null);
  const [editCardId, setEditCardId] = useState<string | null>(null);
  const [showFolders, setShowFolders] = useState(false);
  const [shareForBoard, setShareForBoard] = useState<BoardSummary | null>(null);

  const isAuthed = apiCtx.kind === 'authed';
  const isPublicEdit = apiCtx.kind === 'public-edit';
  const isReadOnly = apiCtx.kind === 'public-view';

  // Fetch the boards list — only when authed; public links target one board.
  const loadBoards = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const d = await apiGet<{ boards: BoardSummary[] }>('/api/kanban/boards');
      setBoards(d.boards);
      // First load: pick default.
      if (!activeBoardId) {
        const def = d.boards.find(b => b.is_default) || d.boards[0];
        if (def) setActiveBoardId(def.id);
      }
    } catch (e) { setErr(String(e)); }
  }, [isAuthed, activeBoardId]);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<BoardData>(urlBoard(apiCtx, activeBoardId ?? undefined));
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    } finally { setLoading(false); }
  }, [apiCtx, activeBoardId]);

  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => {
    // Don't fetch the board until we know which one (authed mode only).
    if (isAuthed && !activeBoardId) return;
    load();
  }, [load, activeBoardId, isAuthed]);

  // Refresh when window regains focus so multi-tab boss stays in sync.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [load]);

  // Optimistic move: update local state, sync to server, revert on error.
  async function moveCard(cardId: string, columnId: string, position: number) {
    if (!data || isReadOnly) return;
    const before = data;
    const next = reposition(data, cardId, columnId, position);
    setData(next);
    try {
      const url = isPublicEdit
        ? `/api/public/board/${(apiCtx as { token: string }).token}/cards/${cardId}/move`
        : `/api/kanban/cards/${cardId}/move`;
      const res = await apiFetch(url, {
        method: isPublicEdit ? 'POST' : 'PUT',
        body: JSON.stringify({ column_id: columnId, position }),
      });
      if (!res.ok) throw new Error(`move failed: ${res.status}`);
      // Light reload to pick up auto-done_at and any concurrent edits.
      load();
    } catch (e) {
      setErr((e as Error).message);
      setData(before);
    }
  }

  // Optimistic column reorder: move sourceId to target's slot, re-persist.
  async function reorderColumn(sourceId: string, targetId: string) {
    if (!data || sourceId === targetId || !isAuthed) return;
    const before = data;
    const order = data.columns.map(c => c.id);
    const fromIdx = order.indexOf(sourceId);
    const toIdx = order.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, sourceId);
    const repositioned = order.map((id, i) => {
      const col = data.columns.find(c => c.id === id)!;
      return { ...col, position: i };
    });
    setData({ ...data, columns: repositioned });
    try {
      const res = await apiFetch('/api/kanban/columns/reorder', {
        method: 'PUT',
        body: JSON.stringify({ column_ids: order }),
      });
      if (!res.ok) throw new Error(`reorder failed: ${res.status}`);
    } catch (e) {
      setErr((e as Error).message);
      setData(before);
    }
  }

  const subsById = useMemo(() => {
    const m = new Map<string, Subscriber>();
    data?.subscribers.forEach(s => m.set(s.id, s));
    return m;
  }, [data?.subscribers]);

  const assigneesByCard = useMemo(() => {
    const m = new Map<string, string[]>();
    data?.assignees.forEach(a => {
      const arr = m.get(a.card_id) || [];
      arr.push(a.subscriber_id);
      m.set(a.card_id, arr);
    });
    return m;
  }, [data?.assignees]);

  const visibleCards = useMemo(() => {
    if (!data) return [] as Card[];
    if (!filterSub) return data.cards;
    if (filterSub === '__unassigned') {
      return data.cards.filter(c => (assigneesByCard.get(c.id) || []).length === 0);
    }
    return data.cards.filter(c => (assigneesByCard.get(c.id) || []).includes(filterSub));
  }, [data, filterSub, assigneesByCard]);

  // Card counts per chip (independent of current filter so labels stay stable).
  const countsByMember = useMemo(() => {
    if (!data) return { total: 0, unassigned: 0, bySub: new Map<string, number>() };
    const bySub = new Map<string, number>();
    let unassigned = 0;
    for (const c of data.cards) {
      const ids = assigneesByCard.get(c.id) || [];
      if (ids.length === 0) unassigned++;
      for (const sid of ids) bySub.set(sid, (bySub.get(sid) ?? 0) + 1);
    }
    return { total: data.cards.length, unassigned, bySub };
  }, [data, assigneesByCard]);

  if (loading && !data) {
    return <div className="p-10 text-center text-slate-400">Loading board…</div>;
  }
  if (!data) {
    return <div className="p-10 text-center text-rose-600">{err}</div>;
  }

  // In public-view mode the board is read-only. In public-edit mode any
  // visitor can mutate cards but cannot rename / delete columns.
  const canEdit = isReadOnly ? false :
    isPublicEdit ? true :
    (me.role === 'boss' || me.role === 'pa' || me.role === 'colleague');
  const canDelete = isReadOnly ? false :
    isPublicEdit ? true :
    (me.role === 'boss' || me.role === 'pa');
  const canReorderColumns = isAuthed && me.role === 'boss';
  const canManageBoards = isAuthed && me.role === 'boss';

  return (
    <ApiContext.Provider value={apiCtx}>
    <div className="flex flex-col h-full">
      <header className="px-6 md:px-10 pt-6 md:pt-8 pb-3 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">
              {isAuthed
                ? (boards.find(b => b.id === activeBoardId)?.name || 'Board')
                : (data.board?.name || 'Board')}
            </h1>
            {isAuthed && boards.length > 0 && (
              <BoardSwitcher
                boards={boards}
                activeId={activeBoardId}
                onPick={setActiveBoardId}
                canManage={canManageBoards}
                onManageFolders={() => setShowFolders(true)}
              />
            )}
            {isReadOnly && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                Read-only share
              </span>
            )}
            {isPublicEdit && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                Editable share
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            {visibleCards.length} card{visibleCards.length === 1 ? '' : 's'} visible
            {filterSub && filterSub !== '__unassigned' &&
              <> · filtered by <b>{subsById.get(filterSub)?.name}</b></>}
            {filterSub === '__unassigned' && <> · showing unassigned only</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5">
            <button onClick={() => setView('columns')}
              className={`px-3 py-1 text-sm rounded ${view==='columns'?'bg-slate-900 text-white':'text-slate-600'}`}>
              Columns
            </button>
            <button onClick={() => setView('swimlanes')}
              className={`px-3 py-1 text-sm rounded ${view==='swimlanes'?'bg-slate-900 text-white':'text-slate-600'}`}>
              By member
            </button>
          </div>
          {canManageBoards && activeBoardId && (
            <button onClick={() => {
              const b = boards.find(b => b.id === activeBoardId);
              if (b) setShareForBoard(b);
            }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 bg-white"
              title="Share this folder via public link">
              <Share2 className="w-4 h-4" /> Share
            </button>
          )}
          <button onClick={() => load()}
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 bg-white"
            title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />
          </button>
        </div>
      </header>

      <MemberTabStrip
        subscribers={data.subscribers}
        value={filterSub}
        onChange={setFilterSub}
        counts={countsByMember}
      />

      {err && (
        <div className="mx-6 md:mx-10 mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{err}</span>
          <button onClick={() => setErr(null)} className="text-rose-400 hover:text-rose-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 md:px-10 pb-8">
        {view === 'columns' ? (
          <ColumnsView
            data={data} visibleCards={visibleCards}
            assigneesByCard={assigneesByCard} subsById={subsById}
            canEdit={canEdit}
            canReorderColumns={canReorderColumns}
            onMove={moveCard}
            onColumnMove={reorderColumn}
            onAddClick={c => setAddToCol(c)}
            onCardClick={id => setEditCardId(id)}
          />
        ) : (
          <SwimlanesView
            data={data} visibleCards={visibleCards}
            assigneesByCard={assigneesByCard}
            canEdit={canEdit}
            onMove={moveCard}
            onAddClick={() => setAddToCol(data.columns[0]?.id ?? null)}
            onCardClick={id => setEditCardId(id)}
          />
        )}
      </div>

      {addToCol && (
        <AddCardModal
          columnId={addToCol}
          columns={data.columns}
          subscribers={data.subscribers}
          defaultAssignee={filterSub}
          onDone={() => { setAddToCol(null); load(); }}
          onClose={() => setAddToCol(null)}
        />
      )}
      {editCardId && (
        <EditCardModal
          cardId={editCardId}
          card={data.cards.find(c => c.id === editCardId)!}
          columns={data.columns}
          subscribers={data.subscribers}
          initialAssignees={assigneesByCard.get(editCardId) || []}
          canDelete={canDelete}
          onDone={() => { setEditCardId(null); load(); }}
          onClose={() => setEditCardId(null)}
        />
      )}
      {showFolders && canManageBoards && (
        <FoldersModal
          boards={boards}
          activeId={activeBoardId}
          onPick={id => { setActiveBoardId(id); setShowFolders(false); }}
          onChanged={loadBoards}
          onShare={b => { setShareForBoard(b); }}
          onClose={() => setShowFolders(false)}
        />
      )}
      {shareForBoard && canManageBoards && (
        <ShareModal
          board={shareForBoard}
          onChanged={loadBoards}
          onClose={() => setShareForBoard(null)}
        />
      )}
    </div>
    </ApiContext.Provider>
  );
}

// ---------- Columns view ------------------------------------------- //
function ColumnsView({
  data, visibleCards, assigneesByCard, subsById, canEdit, canReorderColumns,
  onMove, onColumnMove, onAddClick, onCardClick,
}: {
  data: BoardData;
  visibleCards: Card[];
  assigneesByCard: Map<string, string[]>;
  subsById: Map<string, Subscriber>;
  canEdit: boolean;
  canReorderColumns: boolean;
  onMove: (id: string, col: string, pos: number) => void;
  onColumnMove: (sourceId: string, targetId: string) => void;
  onAddClick: (columnId: string) => void;
  onCardClick: (cardId: string) => void;
}) {
  const cardsByCol = useMemo(() => groupCardsByColumn(visibleCards), [visibleCards]);
  return (
    <div className="flex gap-4 h-full min-h-[400px]" style={{ minWidth: 'fit-content' }}>
      {data.columns.map(col => (
        <ColumnLane
          key={col.id} column={col}
          cards={cardsByCol.get(col.id) || []}
          assigneesByCard={assigneesByCard}
          subsById={subsById}
          canEdit={canEdit}
          canReorderColumns={canReorderColumns}
          onMove={onMove}
          onColumnMove={onColumnMove}
          onAdd={() => onAddClick(col.id)}
          onCardClick={onCardClick}
        />
      ))}
    </div>
  );
}

function ColumnLane({
  column, cards, assigneesByCard, subsById, canEdit, canReorderColumns,
  onMove, onColumnMove, onAdd, onCardClick,
}: {
  column: Column;
  cards: Card[];
  assigneesByCard: Map<string, string[]>;
  subsById: Map<string, Subscriber>;
  canEdit: boolean;
  canReorderColumns: boolean;
  onMove: (id: string, col: string, pos: number) => void;
  onColumnMove: (sourceId: string, targetId: string) => void;
  onAdd: () => void;
  onCardClick: (id: string) => void;
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isOverForCard, setIsOverForCard] = useState(false);
  const [isOverForCol, setIsOverForCol] = useState(false);
  const [colDragging, setColDragging] = useState(false);
  const laneRef = useRef<HTMLDivElement>(null);

  function computeIndex(e: React.DragEvent) {
    const lane = laneRef.current;
    if (!lane) return cards.length;
    const cardEls = [...lane.querySelectorAll('[data-card-id]:not([data-dragging="true"])')] as HTMLElement[];
    for (let i = 0; i < cardEls.length; i++) {
      const r = cardEls[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return cardEls.length;
  }

  return (
    <div className={`w-72 flex-shrink-0 bg-slate-100 rounded-xl flex flex-col transition
        ${isOverForCard ? 'ring-2 ring-indigo-400' : ''}
        ${isOverForCol  ? 'ring-2 ring-emerald-400 ring-offset-2' : ''}
        ${colDragging   ? 'opacity-40' : ''}`}
      onDragEnter={e => {
        if (e.dataTransfer.types.includes('text/card-id')) {
          e.preventDefault();
          setIsOverForCard(true);
        }
      }}
      onDragOver={e => {
        if (e.dataTransfer.types.includes('text/card-id')) {
          e.preventDefault();
          setDropIndex(computeIndex(e));
        }
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsOverForCard(false); setDropIndex(null);
      }}
      onDrop={e => {
        const types = e.dataTransfer.types;
        if (types.includes('text/card-id')) {
          e.preventDefault();
          const cardId = e.dataTransfer.getData('text/card-id');
          const idx = computeIndex(e);
          setIsOverForCard(false); setDropIndex(null);
          if (cardId) onMove(cardId, column.id, idx);
        }
      }}>
      <header
        draggable={canReorderColumns}
        onDragStart={e => {
          if (!canReorderColumns) return;
          e.dataTransfer.setData('text/column-id', column.id);
          e.dataTransfer.effectAllowed = 'move';
          setColDragging(true);
          e.stopPropagation();
        }}
        onDragEnd={() => setColDragging(false)}
        onDragOver={e => {
          if (e.dataTransfer.types.includes('text/column-id')) {
            e.preventDefault(); e.stopPropagation();
            setIsOverForCol(true);
          }
        }}
        onDragLeave={() => setIsOverForCol(false)}
        onDrop={e => {
          if (e.dataTransfer.types.includes('text/column-id')) {
            e.preventDefault(); e.stopPropagation();
            const sourceId = e.dataTransfer.getData('text/column-id');
            setIsOverForCol(false);
            if (sourceId && sourceId !== column.id) onColumnMove(sourceId, column.id);
          }
        }}
        className={`px-3 py-2.5 flex items-center justify-between select-none
          ${canReorderColumns ? 'cursor-grab active:cursor-grabbing' : ''}`}>
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            {column.name}
          </h3>
          <span className="text-xs text-slate-400">
            {cards.length}{column.wip_limit ? `/${column.wip_limit}` : ''}
          </span>
          {column.is_done && <Check className="w-3 h-3 text-emerald-600" />}
        </div>
      </header>
      <div ref={laneRef} className="flex-1 px-2 pb-2 overflow-y-auto space-y-2 min-h-[100px]">
        {cards.map((card, i) => (
          <React.Fragment key={card.id}>
            {dropIndex === i && <DropGhost />}
            <CardView card={card}
              assigneeIds={assigneesByCard.get(card.id) || []}
              subsById={subsById}
              canEdit={canEdit}
              onClick={() => onCardClick(card.id)} />
          </React.Fragment>
        ))}
        {dropIndex === cards.length && <DropGhost />}
        {cards.length === 0 && dropIndex === null && (
          <div className="text-[11px] text-slate-400 text-center py-8">
            Drag cards here
          </div>
        )}
      </div>
      {canEdit && (
        <button onClick={onAdd}
          className="m-2 mt-0 flex items-center gap-1.5 justify-center text-xs text-slate-500
                     hover:text-slate-800 hover:bg-white border border-dashed border-slate-300
                     rounded-lg py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add card
        </button>
      )}
    </div>
  );
}

const DropGhost = () => (
  <div className="bg-indigo-100 border border-dashed border-indigo-300 rounded-lg h-16" />
);

// ---------- Swimlanes view (by member) ------------------------------ //
function SwimlanesView({
  data, visibleCards, assigneesByCard, canEdit,
  onMove, onAddClick, onCardClick,
}: {
  data: BoardData;
  visibleCards: Card[];
  assigneesByCard: Map<string, string[]>;
  canEdit: boolean;
  onMove: (id: string, col: string, pos: number) => void;
  onAddClick: () => void;
  onCardClick: (id: string) => void;
}) {
  const subs = data.subscribers.filter(s => s.active);
  // Cards per (subscriber, column). "Unassigned" lane at the end.
  const bySubThenCol = useMemo(() => {
    const m = new Map<string, Map<string, Card[]>>();
    for (const s of subs) m.set(s.id, new Map());
    m.set('__unassigned', new Map());
    for (const card of visibleCards) {
      const ids = assigneesByCard.get(card.id) || [];
      const targets = ids.length ? ids : ['__unassigned'];
      for (const sid of targets) {
        const col = m.get(sid);
        if (!col) continue;
        const arr = col.get(card.column_id) || [];
        arr.push(card);
        col.set(card.column_id, arr);
      }
    }
    return m;
  }, [subs, visibleCards, assigneesByCard]);

  const lanes: Array<{ id: string; label: string }> = [
    ...subs.map(s => ({ id: s.id, label: s.name })),
    { id: '__unassigned', label: 'Unassigned' },
  ];

  return (
    <div className="space-y-6">
      {lanes.map(lane => (
        <section key={lane.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <header className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">{lane.label}</div>
            <div className="text-xs text-slate-400">
              {[...(bySubThenCol.get(lane.id)?.values() || [])].reduce((n, arr) => n + arr.length, 0)} cards
            </div>
          </header>
          <div className="p-3 flex gap-3 overflow-x-auto">
            {data.columns.map(col => {
              const arr = bySubThenCol.get(lane.id)?.get(col.id) || [];
              return (
                <MiniLane key={col.id} column={col} cards={arr}
                  assigneesByCard={assigneesByCard}
                  canEdit={canEdit && lane.id !== '__unassigned'}
                  onMove={onMove}
                  onAdd={onAddClick}
                  onCardClick={onCardClick} />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function MiniLane({ column, cards, canEdit, onMove, onCardClick }: {
  column: Column; cards: Card[];
  assigneesByCard: Map<string, string[]>;
  canEdit: boolean;
  onMove: (id: string, col: string, pos: number) => void;
  onAdd: () => void;
  onCardClick: (id: string) => void;
}) {
  const [isOver, setIsOver] = useState(false);
  return (
    <div className={`w-56 flex-shrink-0 bg-slate-50 rounded-lg
        ${isOver ? 'ring-2 ring-indigo-400' : ''}`}
      onDragEnter={() => setIsOver(true)}
      onDragOver={e => e.preventDefault()}
      onDragLeave={() => setIsOver(false)}
      onDrop={e => {
        e.preventDefault();
        const cardId = e.dataTransfer.getData('text/card-id');
        setIsOver(false);
        if (cardId) onMove(cardId, column.id, cards.length);
      }}>
      <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
        {column.name} <span className="text-slate-400">({cards.length})</span>
      </div>
      <div className="px-2 pb-2 space-y-1.5 min-h-[40px]">
        {cards.map(card => (
          <CompactCard key={card.id} card={card}
            canEdit={canEdit}
            onClick={() => onCardClick(card.id)} />
        ))}
      </div>
    </div>
  );
}

// ---------- Card views ---------------------------------------------- //
function CardView({ card, assigneeIds, subsById, canEdit, onClick }: {
  card: Card;
  assigneeIds: string[];
  subsById: Map<string, Subscriber>;
  canEdit: boolean;
  onClick: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div data-card-id={card.id}
      data-dragging={dragging ? 'true' : undefined}
      draggable={canEdit}
      onDragStart={e => {
        e.dataTransfer.setData('text/card-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm
                  hover:shadow hover:border-slate-300 cursor-pointer transition
                  ${dragging ? 'opacity-30' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-slate-800 font-medium leading-snug flex-1">
          {card.title}
        </div>
        {card.priority !== 'medium' && <PriorityFlag priority={card.priority} />}
      </div>
      {descriptionPreviewText(card.description) && (
        <div className="text-xs text-slate-500 mt-1 line-clamp-2">
          {descriptionPreviewText(card.description)}
        </div>
      )}
      <CardImageStrip
        urls={[...(card.image_urls || []),
               ...extractDescriptionImageUrls(card.description)]} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex -space-x-1">
          {assigneeIds.slice(0, 4).map(sid => (
            <Avatar key={sid} sub={subsById.get(sid)} />
          ))}
          {assigneeIds.length > 4 && (
            <div className="w-6 h-6 rounded-full bg-slate-200 text-[10px] font-medium
                            grid place-items-center text-slate-600 border border-white">
              +{assigneeIds.length - 4}
            </div>
          )}
        </div>
        {card.due_date && (
          <DueDate date={card.due_date} done={!!card.done_at} />
        )}
      </div>
    </div>
  );
}

function CompactCard({ card, canEdit, onClick }: {
  card: Card; canEdit: boolean; onClick: () => void;
}) {
  return (
    <div data-card-id={card.id}
      draggable={canEdit}
      onDragStart={e => {
        e.dataTransfer.setData('text/card-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onClick}
      className="bg-white border border-slate-200 rounded px-2 py-1 text-xs
                 text-slate-700 cursor-pointer hover:border-slate-300 flex items-center gap-1.5">
      {card.priority !== 'medium' && <PriorityFlag priority={card.priority} />}
      <span className="truncate flex-1">{card.title}</span>
    </div>
  );
}

// ---------- Small UI primitives ------------------------------------- //
function Avatar({ sub }: { sub: Subscriber | undefined }) {
  if (!sub) return null;
  const initials = sub.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const bg = colorFromId(sub.id);
  return (
    <div title={sub.name}
      className="w-6 h-6 rounded-full grid place-items-center text-[10px]
                 font-semibold text-white border border-white"
      style={{ backgroundColor: bg }}>
      {initials}
    </div>
  );
}

function colorFromId(id: string): string {
  const PALETTE = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6',
                   '#14b8a6','#ec4899','#0ea5e9','#84cc16','#f97316'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function PriorityFlag({ priority }: { priority: Card['priority'] }) {
  const colour =
    priority === 'urgent' ? 'text-rose-600' :
    priority === 'high'   ? 'text-amber-600' :
    priority === 'low'    ? 'text-slate-400' : 'text-slate-400';
  return <Flag className={`w-3 h-3 ${colour}`} />;
}

function DueDate({ date, done }: { date: string; done: boolean }) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0,0,0,0);
  const isOverdue = !done && d < today;
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded
      ${done       ? 'text-emerald-700 bg-emerald-50' :
        isOverdue  ? 'text-rose-700    bg-rose-50'    :
                     'text-slate-600   bg-slate-100'}`}>
      <Calendar className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

function MemberTabStrip({ subscribers, value, onChange, counts }: {
  subscribers: Subscriber[];
  value: string | null;
  onChange: (v: string | null) => void;
  counts: { total: number; unassigned: number; bySub: Map<string, number> };
}) {
  const active = subscribers.filter(s => s.active);
  return (
    <nav className="px-6 md:px-10 pb-3 flex items-center gap-1.5 flex-wrap border-b border-slate-100">
      <Users className="w-3.5 h-3.5 text-slate-400 mr-1" />
      <MemberChip label="Everyone" count={counts.total}
        active={value === null} onClick={() => onChange(null)} />
      {active.map(s => (
        <MemberChip key={s.id}
          label={s.name}
          count={counts.bySub.get(s.id) ?? 0}
          active={value === s.id}
          onClick={() => onChange(s.id)} />
      ))}
      <MemberChip label="Unassigned" count={counts.unassigned}
        active={value === '__unassigned'}
        onClick={() => onChange('__unassigned')}
        muted />
    </nav>
  );
}

function MemberChip({ label, count, active, onClick, muted = false }: {
  label: string; count: number; active: boolean;
  onClick: () => void; muted?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition
        ${active
          ? 'bg-slate-900 text-white'
          : muted
            ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            : 'text-slate-700 hover:bg-slate-100'}`}>
      <span>{label}</span>
      <span className={`text-[10px] tabular-nums px-1 rounded
        ${active ? 'bg-white/20 text-white' : 'bg-slate-200/70 text-slate-600'}`}>
        {count}
      </span>
    </button>
  );
}

// ---------- Reposition helper --------------------------------------- //
function reposition(data: BoardData, cardId: string, columnId: string, position: number): BoardData {
  const card = data.cards.find(c => c.id === cardId);
  if (!card) return data;
  const rest = data.cards.filter(c => c.id !== cardId);
  // Group by column, then insert at position.
  const target = rest.filter(c => c.column_id === columnId).sort((a, b) => a.position - b.position);
  target.splice(Math.min(Math.max(0, position), target.length), 0, { ...card, column_id: columnId });
  target.forEach((c, i) => (c.position = i));
  const others = rest.filter(c => c.column_id !== columnId);
  return { ...data, cards: [...others, ...target] };
}

function groupCardsByColumn(cards: Card[]): Map<string, Card[]> {
  const m = new Map<string, Card[]>();
  for (const c of cards) {
    const arr = m.get(c.column_id) || [];
    arr.push(c);
    m.set(c.column_id, arr);
  }
  m.forEach(arr => arr.sort((a, b) => a.position - b.position));
  return m;
}

// ---------- Add card modal ------------------------------------------ //
function AddCardModal({
  columnId, columns, subscribers, defaultAssignee, onDone, onClose,
}: {
  columnId: string;
  columns: Column[];
  subscribers: Subscriber[];
  defaultAssignee: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low'|'medium'|'high'|'urgent'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assignees, setAssignees] = useState<string[]>(defaultAssignee ? [defaultAssignee] : []);
  const [targetCol, setTargetCol] = useState(columnId);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apiCtx = useApiCtx();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(urlCardsBase(apiCtx), {
        method: 'POST',
        body: JSON.stringify({
          column_id: targetCol,
          title: title.trim(),
          description: description || null,
          priority,
          due_date: dueDate || null,
          assignee_ids: assignees,
          image_urls: imageUrls,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <ModalShell title="New card" onClose={onClose} onSubmit={submit}
      footer={<PrimaryBtn type="submit" disabled={!title.trim() || busy} label={busy ? 'Adding…' : 'Add card'} />}>
      <Field label="Title">
        <input required value={title} onChange={e => setTitle(e.target.value)}
          autoFocus
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      </Field>
      <Field label="Description" hint="Optional. Drop or paste images directly into the text.">
        <DescriptionField value={description} onChange={setDescription} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Column">
          <select value={targetCol} onChange={e => setTargetCol(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <PrioritySelect value={priority} onChange={setPriority} />
        </Field>
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </Field>
      </div>
      <AssigneePicker subscribers={subscribers} value={assignees} onChange={setAssignees} />
      <ImageDropZone value={imageUrls} onChange={setImageUrls} />
      {err && <ErrorBox msg={err} />}
    </ModalShell>
  );
}

// ---------- Edit card modal ----------------------------------------- //
function EditCardModal({
  cardId, card, columns, subscribers, initialAssignees, canDelete, onDone, onClose,
}: {
  cardId: string;
  card: Card;
  columns: Column[];
  subscribers: Subscriber[];
  initialAssignees: string[];
  canDelete: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.due_date || '');
  const [assignees, setAssignees] = useState<string[]>(initialAssignees);
  const [imageUrls, setImageUrls] = useState<string[]>(card.image_urls ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const apiCtx = useApiCtx();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`${urlCardsBase(apiCtx)}/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          description: description || null,
          priority,
          due_date: dueDate || null,
          assignee_ids: assignees,
          image_urls: imageUrls,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`${urlCardsBase(apiCtx)}/${cardId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const columnName = columns.find(c => c.id === card.column_id)?.name;

  return (
    <ModalShell wide title="Edit card" onClose={onClose} onSubmit={save}
      subtitle={
        <>
          In <b>{columnName}</b> · created {new Date(card.created_at).toLocaleString()}
          {card.done_at && <> · done {new Date(card.done_at).toLocaleString()}</>}
        </>
      }
      footer={
        <>
          {canDelete && !confirmDel && (
            <button type="button" onClick={() => setConfirmDel(true)} disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 disabled:opacity-40 mr-auto">
              <Trash2 className="w-3.5 h-3.5" /> Delete card
            </button>
          )}
          {confirmDel && (
            <div className="flex items-center gap-2 text-xs text-rose-700 mr-auto">
              <AlertTriangle className="w-4 h-4" />
              Delete this card?
              <button type="button" onClick={remove} disabled={busy}
                className="ml-1 px-2.5 py-1 text-xs font-medium bg-rose-600 hover:bg-rose-700
                           disabled:opacity-40 text-white rounded-lg">Yes</button>
              <button type="button" onClick={() => setConfirmDel(false)}
                className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded">
                No
              </button>
            </div>
          )}
          <PrimaryBtn type="submit" disabled={!title.trim() || busy}
            label={busy ? 'Saving…' : 'Save changes'} />
        </>
      }>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4 -m-2">
        <div className="space-y-4 p-2 min-w-0">
          <Field label="Title">
            <input required value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="Description" hint="Drop or paste images directly into the text.">
            <DescriptionField value={description} onChange={setDescription} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <PrioritySelect value={priority} onChange={setPriority} />
            </Field>
            <Field label="Due date">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </Field>
          </div>
          <AssigneePicker subscribers={subscribers} value={assignees} onChange={setAssignees} />
          <ImageDropZone value={imageUrls} onChange={setImageUrls} />
          {err && <ErrorBox msg={err} />}
        </div>
        <CardTimelinePanel cardId={cardId}
          subsByEmail={useMemo(() => {
            const m = new Map<string, Subscriber>();
            subscribers.forEach(s => m.set(s.id, s));
            return m;
          }, [subscribers])} />
      </div>
    </ModalShell>
  );
}

// ---------- Reusable form bits -------------------------------------- //
function ModalShell({
  title, subtitle, onClose, onSubmit, children, footer, wide = false,
}: {
  title: string; subtitle?: React.ReactNode;
  onClose: () => void; onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode; footer: React.ReactNode;
  wide?: boolean;
}) {
  const widthCls = wide ? 'max-w-4xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={onSubmit}
        className={`bg-white rounded-2xl w-full ${widthCls} shadow-2xl overflow-hidden max-h-[92vh] flex flex-col`}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="p-6 space-y-4 overflow-y-auto">{children}</div>
        <footer className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center gap-2">
          {footer}
        </footer>
      </form>
    </div>
  );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-700">{label}</span>
    <div className="mt-1">{children}</div>
    {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
  </label>
);

const PrimaryBtn = ({ type, disabled, label }: {
  type: 'submit' | 'button'; disabled?: boolean; label: string;
}) => (
  <button type={type} disabled={disabled}
    className="ml-auto px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
               disabled:opacity-40 text-white rounded-lg">
    {label}
  </button>
);

function PrioritySelect({ value, onChange }: {
  value: Card['priority']; onChange: (v: Card['priority']) => void;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as Card['priority'])}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="urgent">Urgent</option>
    </select>
  );
}

function AssigneePicker({ subscribers, value, onChange }: {
  subscribers: Subscriber[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter(x => x !== id));
    else if (value.length < 5) onChange([...value, id]);
  }
  return (
    <Field label={`Assignees (${value.length}/5)`}>
      <div className="flex flex-wrap gap-1.5">
        {subscribers.filter(s => s.active).map(s => {
          const on = value.includes(s.id);
          return (
            <button key={s.id} type="button" onClick={() => toggle(s.id)}
              disabled={!on && value.length >= 5}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
                          border transition disabled:opacity-30 disabled:cursor-not-allowed
                          ${on
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              <Avatar sub={s} />
              <span>{s.name}</span>
            </button>
          );
        })}
        {subscribers.filter(s => s.active).length === 0 && (
          <p className="text-xs text-slate-400">
            No active subscribers — add teammates on the Team page first.
          </p>
        )}
      </div>
    </Field>
  );
}

const ErrorBox = ({ msg }: { msg: string }) => (
  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
    {msg}
  </div>
);

// Drag-drop / paste / click-to-pick image attacher. Each accepted file
// is uploaded to /api/uploads/image and the returned Cloudflare Images
// URL is appended to `value`. Caps at 10 attachments per card.
const MAX_IMAGES_PER_CARD = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Single source of truth for image upload — used by both the card-level
// ImageDropZone and the in-description paste/drop handler. Routes via
// /api/public/board/:token/uploads/image when called from a share-edit
// session so unauthenticated visitors can still attach screenshots.
async function uploadImageFile(file: File, ctx: ApiCtx): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name} is larger than 8 MB`);
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
  const res = await apiFetch(urlUpload(ctx), {
    method: 'POST',
    body: JSON.stringify({ data_url: dataUrl, filename: file.name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `upload HTTP ${res.status}`);
  }
  const { url } = await res.json();
  return url as string;
}

// Pull just the image URLs out of a markdown description so we can
// render thumbnails / strip them from text previews.
function extractDescriptionImageUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function descriptionPreviewText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function ImageDropZone({ value, onChange }: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  const apiCtx = useApiCtx();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setErr(null);
    const room = MAX_IMAGES_PER_CARD - value.length;
    if (room <= 0) {
      setErr(`Max ${MAX_IMAGES_PER_CARD} images per card.`);
      return;
    }
    const accepted = files
      .filter(f => f.type.startsWith('image/'))
      .slice(0, room);
    if (accepted.length === 0) {
      setErr('Only image files are accepted.');
      return;
    }
    setBusy(true);
    const newUrls: string[] = [];
    for (const f of accepted) {
      try {
        newUrls.push(await uploadImageFile(f, apiCtx));
      } catch (e) {
        setErr(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (newUrls.length > 0) onChange([...value, ...newUrls]);
    setBusy(false);
  }, [value, onChange, apiCtx]);

  // Window-level paste listener — image from clipboard pastes into the
  // open modal regardless of which input has focus.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f && f.type.startsWith('image/')) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        upload(files);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [upload]);

  function remove(url: string) {
    onChange(value.filter(u => u !== url));
  }

  return (
    <Field label={`Images (${value.length}/${MAX_IMAGES_PER_CARD})`}
      hint="Drop, paste (⌘V), or click to attach. PNG / JPG / GIF / WebP up to 8 MB.">
      <div
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault(); setOver(false);
          upload(Array.from(e.dataTransfer?.files || []));
        }}
        onClick={() => fileInput.current?.click()}
        className={`border-2 border-dashed rounded-lg px-3 py-4 text-center cursor-pointer transition
          ${over
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'}`}>
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          {busy
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
            : <><ImagePlus className="w-4 h-4" /> Drop, paste, or click to add images</>}
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden
          onChange={e => {
            upload(Array.from(e.target.files || []));
            e.target.value = '';
          }} />
      </div>

      {value.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {value.map(url => (
            <div key={url} className="relative group">
              <img src={url} alt=""
                className="w-full h-20 object-cover rounded-md border border-slate-200" />
              <button type="button" onClick={() => remove(url)}
                className="absolute top-1 right-1 bg-slate-900/80 hover:bg-slate-900
                           text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                aria-label="Remove image">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
    </Field>
  );
}

// Description textarea that accepts pasted / dropped images and inserts
// them as Markdown image syntax at the cursor. Underneath it we render
// thumbnails of any images found in the description so the user can
// see what's been attached without leaving edit mode. Removing a
// thumbnail strips the corresponding `![](url)` from the source.
function DescriptionField({ value, onChange }: {
  value: string; onChange: (v: string) => void;
}) {
  const apiCtx = useApiCtx();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const insertImagesFromFiles = useCallback(async (files: File[]) => {
    const accepted = files.filter(f => f.type.startsWith('image/'));
    if (accepted.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const urls: string[] = [];
      for (const f of accepted) {
        try { urls.push(await uploadImageFile(f, apiCtx)); }
        catch (e) { setErr(`${f.name}: ${(e as Error).message}`); }
      }
      if (urls.length === 0) return;
      const md = urls.map(u => `![](${u})`).join('\n');
      const ta = ref.current;
      if (!ta) {
        onChange(value + (value.endsWith('\n') || value === '' ? '' : '\n') + md);
        return;
      }
      const start = ta.selectionStart ?? value.length;
      const end = ta.selectionEnd ?? value.length;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const leadingNl = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
      const trailingNl = after.startsWith('\n') || after === '' ? '' : '\n';
      const next = before + leadingNl + md + trailingNl + after;
      onChange(next);
      const cursor = (before + leadingNl + md + trailingNl).length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(cursor, cursor);
      });
    } finally { setBusy(false); }
  }, [value, onChange, apiCtx]);

  const descUrls = extractDescriptionImageUrls(value);

  function removeImage(url: string) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)\\n?`, 'g');
    onChange(value.replace(re, '').replace(/\n{3,}/g, '\n\n'));
  }

  return (
    <div>
      <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)}
        rows={4}
        placeholder="Drop, paste (⌘V), or type. Supports Markdown image links."
        onPaste={e => {
          const items = e.clipboardData?.items; if (!items) return;
          const files: File[] = [];
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind === 'file') {
              const f = it.getAsFile();
              if (f && f.type.startsWith('image/')) files.push(f);
            }
          }
          if (files.length > 0) {
            e.preventDefault();
            insertImagesFromFiles(files);
          }
        }}
        onDrop={e => {
          const files = Array.from(e.dataTransfer?.files || [])
            .filter(f => f.type.startsWith('image/'));
          if (files.length > 0) {
            e.preventDefault();
            insertImagesFromFiles(files);
          }
        }}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
      {busy && (
        <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
        </p>
      )}
      {err && <p className="text-xs text-rose-700 mt-1">{err}</p>}
      {descUrls.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {descUrls.map(u => (
            <div key={u} className="relative group">
              <img src={u} alt=""
                className="w-full h-20 object-cover rounded-md border border-slate-200" />
              <button type="button" onClick={() => removeImage(u)}
                className="absolute top-1 right-1 bg-slate-900/80 hover:bg-slate-900
                           text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                aria-label="Remove image">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Per-card timeline panel (right rail of EditCardModal) -- //
// Two tabs: Comments (default) — chronological, paste-an-image works
// just like the description; Activity — read-only feed of card events
// from the existing kanban_activity table. The two are merged into one
// chronological feed if Activity is selected; Comments stays comment-only
// to avoid noise when the user just wants to leave a note.

interface CommentRow {
  id: string; card_id: string; author_email: string;
  body: string; created_at: string; edited_at: string | null;
}
interface ActivityEvent {
  id: string; actor_email: string; action: string;
  payload: Record<string, unknown>; created_at: string;
}

function CardTimelinePanel({ cardId, subsByEmail }: {
  cardId: string;
  subsByEmail: Map<string, Subscriber>;
}) {
  const apiCtx = useApiCtx();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const timelineUrl = apiCtx.kind === 'authed'
    ? `/api/kanban/cards/${cardId}/timeline`
    : `/api/public/board/${apiCtx.token}/cards/${cardId}/timeline`;
  const commentPostUrl = apiCtx.kind === 'authed'
    ? `/api/kanban/cards/${cardId}/comments`
    : `/api/public/board/${apiCtx.token}/cards/${cardId}/comments`;
  const canPost = apiCtx.kind !== 'public-view';

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(timelineUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      setComments(body.comments || []);
      setEvents(body.events || []);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [timelineUrl]);

  useEffect(() => { reload(); }, [reload]);

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setPosting(true); setErr(null);
    try {
      const r = await apiFetch(commentPostUrl, {
        method: 'POST', body: JSON.stringify({ body }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setDraft('');
      reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setPosting(false); }
  }

  // Merge for Activity tab — comments inserted into events as 'commented' rows.
  const mergedEvents = useMemo<ActivityEvent[]>(() => {
    const fromComments: ActivityEvent[] = comments.map(c => ({
      id: 'c:' + c.id,
      actor_email: c.author_email,
      action: 'card.commented',
      payload: { body_preview: c.body.slice(0, 120) },
      created_at: c.created_at,
    }));
    return [...events.filter(e => e.action !== 'card.commented'), ...fromComments]
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [comments, events]);

  return (
    <aside className="bg-slate-50 border-l border-slate-200 -my-2 -mr-2 p-3 flex flex-col">
      <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5 mb-3 self-start">
        <button type="button" onClick={() => setTab('comments')}
          className={`px-3 py-1 text-xs rounded ${tab==='comments'?'bg-slate-900 text-white':'text-slate-600'}`}>
          Comments {comments.length > 0 && `(${comments.length})`}
        </button>
        <button type="button" onClick={() => setTab('activity')}
          className={`px-3 py-1 text-xs rounded ${tab==='activity'?'bg-slate-900 text-white':'text-slate-600'}`}>
          Activity
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && tab === 'comments' && comments.length === 0 && (
          <p className="text-xs text-slate-400 italic">No comments yet. Be the first.</p>
        )}
        {!loading && tab === 'comments' && comments.map(c => (
          <CommentBubble key={c.id} c={c} />
        ))}
        {!loading && tab === 'activity' && mergedEvents.length === 0 && (
          <p className="text-xs text-slate-400 italic">No activity yet.</p>
        )}
        {!loading && tab === 'activity' && mergedEvents.map(ev => (
          <ActivityRow key={ev.id} ev={ev} />
        ))}
      </div>
      {tab === 'comments' && canPost && (
        <form onSubmit={postComment} className="mt-3 pt-3 border-t border-slate-200 space-y-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            rows={2}
            placeholder="Write a comment…"
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white" />
          <button type="submit" disabled={!draft.trim() || posting}
            className="w-full px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800
                       disabled:opacity-40 text-white rounded-lg">
            {posting ? 'Posting…' : 'Add comment'}
          </button>
          {err && <p className="text-xs text-rose-700">{err}</p>}
        </form>
      )}
    </aside>
  );
}

function CommentBubble({ c }: { c: CommentRow }) {
  const author = c.author_email === 'share-link' ? 'Share link' : c.author_email.split('@')[0];
  return (
    <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-700">{author}</span>
        <span className="text-slate-400">{relTime(c.created_at)}</span>
      </div>
      <div className="text-slate-700 whitespace-pre-wrap break-words">{c.body}</div>
      {c.edited_at && (
        <span className="text-[10px] text-slate-400">edited</span>
      )}
    </div>
  );
}

function ActivityRow({ ev }: { ev: ActivityEvent }) {
  const verb = ACTIVITY_VERBS[ev.action] || ev.action.replace('card.', '');
  const actor = ev.actor_email === 'share-link' ? 'Share link'
    : ev.actor_email === 'system' ? 'System'
    : ev.actor_email.split('@')[0];
  const detail = ev.action === 'card.commented' && ev.payload?.body_preview
    ? `: "${String(ev.payload.body_preview).slice(0, 60)}"`
    : '';
  return (
    <div className="text-xs text-slate-600 flex items-baseline gap-2">
      <span className="text-slate-400 tabular-nums w-12 flex-shrink-0">
        {relTime(ev.created_at)}
      </span>
      <span className="flex-1">
        <b className="text-slate-700">{actor}</b> {verb}{detail}
      </span>
    </div>
  );
}

const ACTIVITY_VERBS: Record<string, string> = {
  'card.created':    'created the card',
  'card.updated':    'edited the card',
  'card.moved':      'moved the card',
  'card.assigned':   'assigned a member',
  'card.unassigned': 'unassigned a member',
  'card.done':       'marked done',
  'card.reopened':   'reopened',
  'card.deleted':    'deleted the card',
  'card.commented':  'commented',
};

function relTime(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString();
}

// Small thumbnail strip rendered inline on the board card.
function CardImageStrip({ urls }: { urls: string[] }) {
  if (!urls || urls.length === 0) return null;
  const shown = urls.slice(0, 3);
  const extra = urls.length - shown.length;
  return (
    <div className="flex gap-1 mt-2">
      {shown.map(u => (
        <img key={u} src={u} alt=""
          className="w-12 h-12 object-cover rounded border border-slate-200" />
      ))}
      {extra > 0 && (
        <div className="w-12 h-12 rounded border border-slate-200 bg-slate-50
                        text-xs text-slate-500 flex items-center justify-center">
          +{extra}
        </div>
      )}
    </div>
  );
}

// ---------- Folder switcher (boss-only chrome) ---------------------- //
function BoardSwitcher({ boards, activeId, onPick, canManage, onManageFolders }: {
  boards: BoardSummary[]; activeId: string | null;
  onPick: (id: string) => void;
  canManage: boolean;
  onManageFolders: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', close);
      return () => document.removeEventListener('mousedown', close);
    }
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium
                   text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
        <Folder className="w-3.5 h-3.5" /> Switch folder
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 w-56 bg-white rounded-lg shadow-lg
                        border border-slate-200 overflow-hidden">
          <div className="max-h-72 overflow-y-auto py-1">
            {boards.map(b => (
              <button key={b.id}
                onClick={() => { onPick(b.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between
                  ${b.id === activeId ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700'}`}>
                <span className="flex items-center gap-2">
                  <Folder className="w-3.5 h-3.5" /> {b.name}
                </span>
                {b.is_default && <span className="text-[10px] text-slate-400">default</span>}
              </button>
            ))}
          </div>
          {canManage && (
            <button onClick={() => { setOpen(false); onManageFolders(); }}
              className="w-full text-left px-3 py-2 text-xs text-slate-500 border-t border-slate-100
                         hover:bg-slate-50 inline-flex items-center gap-1.5">
              <FolderPlus className="w-3.5 h-3.5" /> Manage folders…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Folders manager ----------------------------------------- //
function FoldersModal({ boards, activeId, onPick, onChanged, onShare, onClose }: {
  boards: BoardSummary[]; activeId: string | null;
  onPick: (id: string) => void;
  onChanged: () => void;
  onShare: (b: BoardSummary) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch('/api/kanban/boards', {
        method: 'POST', body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setNewName('');
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function setDefault(id: string) {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/kanban/boards/${id}`, {
        method: 'PATCH', body: JSON.stringify({ is_default: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function rename(id: string) {
    if (!renameValue.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/kanban/boards/${id}`, {
        method: 'PATCH', body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRenamingId(null);
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this folder? Cards inside are kept but hidden until reassigned.')) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/kanban/boards/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <ModalShell title="Folders" subtitle="Each folder is its own Kanban board." onClose={onClose}
      onSubmit={e => e.preventDefault()}
      footer={<button type="button" onClick={onClose}
        className="ml-auto px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Done</button>}>
      <form onSubmit={create} className="flex items-center gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="New folder name"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        <button type="submit" disabled={!newName.trim() || busy}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-slate-900 hover:bg-slate-800
                     disabled:opacity-40 text-white rounded-lg">
          <FolderPlus className="w-4 h-4" /> Add
        </button>
      </form>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
        {boards.map(b => (
          <li key={b.id} className="px-3 py-2 flex items-center gap-2">
            <Folder className="w-4 h-4 text-slate-400 flex-shrink-0" />
            {renamingId === b.id ? (
              <input autoFocus value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') rename(b.id); if (e.key === 'Escape') setRenamingId(null); }}
                className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm" />
            ) : (
              <button onClick={() => onPick(b.id)}
                className={`flex-1 text-left text-sm truncate ${b.id === activeId ? 'font-semibold text-indigo-700' : 'text-slate-700 hover:underline'}`}>
                {b.name}
              </button>
            )}
            {b.is_default && <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-100">default</span>}
            {b.share_enabled && <span className="text-[10px] text-emerald-700 px-1.5 py-0.5 rounded bg-emerald-50">shared</span>}
            <div className="flex items-center gap-1 ml-auto">
              {renamingId === b.id ? (
                <button onClick={() => rename(b.id)} disabled={busy}
                  className="text-xs text-indigo-700 hover:underline">Save</button>
              ) : (
                <button onClick={() => { setRenamingId(b.id); setRenameValue(b.name); }}
                  className="p-1 text-slate-400 hover:text-slate-700" title="Rename">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => onShare(b)}
                className="p-1 text-slate-400 hover:text-slate-700" title="Share">
                <Share2 className="w-3.5 h-3.5" />
              </button>
              {!b.is_default && (
                <button onClick={() => setDefault(b.id)} disabled={busy}
                  className="text-[10px] px-2 py-1 text-slate-500 hover:text-slate-800
                             border border-slate-200 rounded hover:bg-slate-50">
                  Make default
                </button>
              )}
              {!b.is_default && (
                <button onClick={() => remove(b.id)} disabled={busy}
                  className="p-1 text-slate-400 hover:text-rose-600" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {err && <ErrorBox msg={err} />}
    </ModalShell>
  );
}

// ---------- Share modal --------------------------------------------- //
function ShareModal({ board, onChanged, onClose }: {
  board: BoardSummary; onChanged: () => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(board.share_mode);
  const [token, setToken] = useState<string | null>(board.share_token);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = token
    ? `${window.location.origin}/share/${token}`
    : null;

  async function generate(nextMode: 'view' | 'edit') {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/kanban/boards/${board.id}/share`, {
        method: 'POST', body: JSON.stringify({ mode: nextMode }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setToken(body.board.share_token);
      setMode(body.board.share_mode);
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function changeMode(nextMode: 'view' | 'edit') {
    if (!token) {
      // No active link yet — generate one in the requested mode.
      await generate(nextMode);
      return;
    }
    // Same call regenerates the token AND updates the mode in one round trip.
    await generate(nextMode);
  }

  async function revoke() {
    if (!window.confirm('Revoke the share link? Anyone with the URL loses access immediately.')) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/kanban/boards/${board.id}/share/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setToken(null);
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; user will copy manually */ }
  }

  return (
    <ModalShell title={`Share "${board.name}"`}
      subtitle="Anyone with the link below can access this folder. No login required."
      onClose={onClose}
      onSubmit={e => e.preventDefault()}
      footer={<button type="button" onClick={onClose}
        className="ml-auto px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Done</button>}>
      <Field label="Permission">
        <div className="flex gap-2">
          {(['edit', 'view'] as const).map(m => (
            <button key={m} type="button" onClick={() => changeMode(m)} disabled={busy}
              className={`flex-1 text-sm py-2 rounded-lg border transition disabled:opacity-50
                ${mode === m
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>
              {m === 'edit' ? 'Anyone with link can edit' : 'View only'}
            </button>
          ))}
        </div>
      </Field>

      {!token ? (
        <button type="button" onClick={() => generate(mode)} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium
                     bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg">
          <LinkIcon className="w-4 h-4" /> Generate share link
        </button>
      ) : (
        <>
          <Field label="Share link">
            <div className="flex items-center gap-2">
              <input readOnly value={shareUrl ?? ''}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
              <button type="button" onClick={copy}
                className="px-3 py-2 text-sm bg-slate-900 hover:bg-slate-800 text-white rounded-lg">
                {copied ? <Check className="w-4 h-4" /> : 'Copy'}
              </button>
            </div>
          </Field>
          <button type="button" onClick={revoke} disabled={busy}
            className="text-xs text-rose-600 hover:underline">
            Revoke link
          </button>
        </>
      )}

      {err && <ErrorBox msg={err} />}
    </ModalShell>
  );
}
