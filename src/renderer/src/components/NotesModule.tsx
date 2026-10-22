import RichSurface from './RichSurface'

export default function NotesModule({ moduleId }: { moduleId: string }): React.JSX.Element {
  return <RichSurface moduleId={moduleId} placeholder="Write a note…" />
}
