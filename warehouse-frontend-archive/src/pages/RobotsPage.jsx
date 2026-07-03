import RobotCardGrid from './components/RobotCardGrid'

export default function RobotsPage({ snapshot }) {
  return (
    <div
      className="cyber-card h-full flex flex-col"
      style={{ borderRadius: 0, border: 'none' }}
    >
      <RobotCardGrid snapshot={snapshot} />
    </div>
  )
}