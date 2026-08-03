interface StickyTag {
  id: string
  name: string
  color: string
}

interface StickyNote {
  id: string
  tagId: string | null
  content: string
  createdAt: number
  updatedAt: number
}

interface StickyData {
  tags: StickyTag[]
  notes: StickyNote[]
}

interface StickyApi {
  load: () => Promise<StickyData>
  save: (data: StickyData) => Promise<StickyData>
}
