import { useEffect, useMemo, useReducer, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import {
  TODOS_STORAGE_KEY,
  countActive,
  parseStoredTodos,
  selectVisible,
  serializeTodos,
  todoReducer,
} from './todos'
import type { Todo, TodoFilter } from './types'

const FILTERS: ReadonlyArray<{ value: TodoFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
]

function loadTodos(): Todo[] {
  if (typeof localStorage === 'undefined') return []
  return parseStoredTodos(localStorage.getItem(TODOS_STORAGE_KEY))
}

function App() {
  const [todos, dispatch] = useReducer(todoReducer, undefined, loadTodos)
  const [filter, setFilter] = useState<TodoFilter>('all')
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  useEffect(() => {
    localStorage.setItem(TODOS_STORAGE_KEY, serializeTodos(todos))
  }, [todos])

  const visibleTodos = useMemo(() => selectVisible(todos, filter), [todos, filter])
  const activeCount = countActive(todos)
  const completedCount = todos.length - activeCount
  const allCompleted = todos.length > 0 && activeCount === 0

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.trim()) return
    dispatch({ type: 'add', title: draft })
    setDraft('')
  }

  function startEditing(todo: Todo) {
    setEditingId(todo.id)
    setEditingTitle(todo.title)
  }

  function commitEditing() {
    if (editingId === null) return
    dispatch({ type: 'edit', id: editingId, title: editingTitle })
    setEditingId(null)
  }

  return (
    <main className="app">
      <header className="app__header">
        <h1>Todo</h1>
        <p className="app__subtitle">
          {todos.length === 0
            ? 'Nothing on the list yet.'
            : `${activeCount} active, ${completedCount} completed`}
        </p>
      </header>

      <form className="composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="new-todo">
          New todo
        </label>
        <input
          id="new-todo"
          className="composer__input"
          value={draft}
          placeholder="What needs to be done?"
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="composer__submit" disabled={!draft.trim()}>
          Add
        </button>
      </form>

      {todos.length > 0 && (
        <div className="toolbar">
          <button
            type="button"
            className="toolbar__toggle"
            onClick={() => dispatch({ type: 'toggleAll', completed: !allCompleted })}
          >
            {allCompleted ? 'Uncheck all' : 'Check all'}
          </button>
          <div className="filters" role="group" aria-label="Filter todos">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="filters__button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="todos">
        {visibleTodos.map((todo) => (
          <li key={todo.id} className={todo.completed ? 'todo todo--completed' : 'todo'}>
            <input
              type="checkbox"
              className="todo__checkbox"
              checked={todo.completed}
              aria-label={`Toggle ${todo.title}`}
              onChange={() => dispatch({ type: 'toggle', id: todo.id })}
            />

            {editingId === todo.id ? (
              <input
                className="todo__edit"
                value={editingTitle}
                autoFocus
                aria-label={`Edit ${todo.title}`}
                onChange={(event) => setEditingTitle(event.target.value)}
                onBlur={commitEditing}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitEditing()
                  if (event.key === 'Escape') {
                    setEditingId(null)
                  }
                }}
              />
            ) : (
              <span className="todo__title" onDoubleClick={() => startEditing(todo)}>
                {todo.title}
              </span>
            )}

            <div className="todo__actions">
              {editingId !== todo.id && (
                <button
                  type="button"
                  className="todo__action"
                  onClick={() => startEditing(todo)}
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                className="todo__action todo__action--danger"
                onClick={() => dispatch({ type: 'remove', id: todo.id })}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {todos.length > 0 && visibleTodos.length === 0 && (
        <p className="hint">No {filter} todos.</p>
      )}

      {completedCount > 0 && (
        <footer className="app__footer">
          <button
            type="button"
            className="app__clear"
            onClick={() => dispatch({ type: 'clearCompleted' })}
          >
            Clear completed ({completedCount})
          </button>
        </footer>
      )}
    </main>
  )
}

export default App
