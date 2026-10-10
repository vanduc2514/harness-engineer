import { describe, expect, it } from 'vitest'
import {
  countActive,
  parseStoredTodos,
  selectVisible,
  serializeTodos,
  todoReducer,
} from './todos'
import type { Todo } from './types'

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: 'todo-1',
  title: 'Write tests',
  completed: false,
  createdAt: 0,
  ...overrides,
})

describe('todoReducer', () => {
  it('adds a trimmed todo', () => {
    expect(
      todoReducer([], { type: 'add', title: '  Ship it  ', id: 'a', createdAt: 7 }),
    ).toEqual([{ id: 'a', title: 'Ship it', completed: false, createdAt: 7 }])
  })

  it('ignores blank titles', () => {
    expect(todoReducer([], { type: 'add', title: '   ' })).toEqual([])
  })

  it('toggles only the matching todo', () => {
    const todos = [todo({ id: 'a' }), todo({ id: 'b' })]
    expect(todoReducer(todos, { type: 'toggle', id: 'b' })).toEqual([
      todo({ id: 'a' }),
      todo({ id: 'b', completed: true }),
    ])
  })

  it('edits a title but keeps blank input from wiping it', () => {
    const todos = [todo({ id: 'a' })]
    expect(todoReducer(todos, { type: 'edit', id: 'a', title: 'Renamed' })).toEqual([
      todo({ id: 'a', title: 'Renamed' }),
    ])
    expect(todoReducer(todos, { type: 'edit', id: 'a', title: '  ' })).toEqual(todos)
  })

  it('removes a single todo and clears completed ones', () => {
    const todos = [todo({ id: 'a' }), todo({ id: 'b', completed: true })]
    expect(todoReducer(todos, { type: 'remove', id: 'a' })).toEqual([
      todo({ id: 'b', completed: true }),
    ])
    expect(todoReducer(todos, { type: 'clearCompleted' })).toEqual([todo({ id: 'a' })])
  })

  it('toggles every todo at once', () => {
    const todos = [todo({ id: 'a' }), todo({ id: 'b' })]
    expect(todoReducer(todos, { type: 'toggleAll', completed: true })).toEqual([
      todo({ id: 'a', completed: true }),
      todo({ id: 'b', completed: true }),
    ])
  })

  it('returns the same state for an unknown action', () => {
    const todos = [todo()]
    expect(todoReducer(todos, { type: 'nope' } as never)).toBe(todos)
  })
})

describe('selectVisible', () => {
  const todos = [todo({ id: 'a' }), todo({ id: 'b', completed: true })]

  it('filters by status', () => {
    expect(selectVisible(todos, 'all')).toHaveLength(2)
    expect(selectVisible(todos, 'active').map((item) => item.id)).toEqual(['a'])
    expect(selectVisible(todos, 'completed').map((item) => item.id)).toEqual(['b'])
  })
})

describe('countActive', () => {
  it('counts unfinished todos', () => {
    expect(countActive([todo({ id: 'a' }), todo({ id: 'b', completed: true })])).toBe(1)
  })
})

describe('stored todos', () => {
  it('round-trips valid todos', () => {
    const todos = [todo()]
    expect(parseStoredTodos(serializeTodos(todos))).toEqual(todos)
  })

  it('drops malformed payloads and entries', () => {
    expect(parseStoredTodos(null)).toEqual([])
    expect(parseStoredTodos('not json')).toEqual([])
    expect(parseStoredTodos('{"a":1}')).toEqual([])
    expect(
      parseStoredTodos(
        '[{"id":"a"},{"id":"b","title":"ok","completed":false,"createdAt":1}]',
      ),
    ).toEqual([{ id: 'b', title: 'ok', completed: false, createdAt: 1 }])
  })
})
