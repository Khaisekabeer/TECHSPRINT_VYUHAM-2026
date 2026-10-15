import { Panel } from '../../components/ui';

export default function GameLinks() {
  return (
    <Panel>
      <div className="eyebrow">Live game</div>
      <h2 className="display" style={{ fontSize: '2.4rem', margin: '10px 0 8px' }}>Run the quiz</h2>
      <p className="dim" style={{ margin: '0 0 20px', maxWidth: 560, lineHeight: 1.5 }}>
        Open the host console to start the game and move through questions, and the projector screen on the
        laptop connected to the big screen. The host console uses your current sign-in.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <a className="btn btn-heat" href="/host" target="_blank" rel="noreferrer">Open host console ↗</a>
        <a className="btn btn-ghost" href="/screen" target="_blank" rel="noreferrer">Open projector screen ↗</a>
      </div>
    </Panel>
  );
}
