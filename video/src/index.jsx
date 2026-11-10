import { Composition, registerRoot } from 'remotion'
import { Demo, FPS, DURATION } from './Demo.jsx'

const Root = () => (
  <Composition id="Demo" component={Demo} durationInFrames={DURATION} fps={FPS} width={1280} height={720} />
)

registerRoot(Root)
