type TodoPriority = 'none' | 'low' | 'medium' | 'high'

interface TodoGroup {
  id: string
  name: string
  color: string
}

interface TodoItem {
  id: string
  text: string
  done: boolean
  priority: TodoPriority
  dueDate: number | null
  groupId: string | null
  createdAt: number
  updatedAt: number
}

interface TodoData {
  groups: TodoGroup[]
  items: TodoItem[]
}

interface TodoApi {
  load: () => Promise<TodoData>
  save: (data: TodoData) => Promise<TodoData>
}
