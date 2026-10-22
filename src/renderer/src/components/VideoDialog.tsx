import { useState } from 'react'
import { youtubeVideoId } from '../editor/extensions'
import { useDoto } from '../store'

interface VideoDialogProps {
  onCancel: () => void
  onEmbed: (videoId: string) => void
  onUpload: (src: string) => void
}

export default function VideoDialog({ onCancel, onEmbed, onUpload }: VideoDialogProps): React.JSX.Element {
  const [link, setLink] = useState('')
  const [rejected, setRejected] = useState(false)
  const videoId = youtubeVideoId(link)
  const pageId = useDoto((state) => state.tab?.id)

  const upload = async (): Promise<void> => {
    if (!pageId) return
    const src = await window.doto.pickVideo(pageId)
    if (src) onUpload(src)
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-dialog-title"
        onSubmit={(event) => {
          event.preventDefault()
          if (videoId) onEmbed(videoId)
          else setRejected(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      >
        <h2 id="video-dialog-title" className="dialog__title">
          Add a video
        </h2>
        <p className="dialog__hint">Paste a YouTube link, or upload a video from this computer.</p>
        <button type="button" className="button dialog__upload" onClick={() => void upload()}>
          Upload a video
        </button>
        <input
          className="field"
          aria-label="YouTube link"
          placeholder="https://www.youtube.com/watch?v=…"
          value={link}
          autoFocus
          onChange={(event) => {
            setLink(event.target.value)
            setRejected(false)
          }}
        />
        {rejected && (
          <p className="dialog__error" role="alert">
            That is not a YouTube video link.
          </p>
        )}
        {videoId && <img className="dialog__preview" src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" />}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Embed
          </button>
        </div>
      </form>
    </div>
  )
}
