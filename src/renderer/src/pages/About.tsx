import { Typography } from 'antd'

function About(): React.JSX.Element {
  return (
    <div>
      <Typography.Title level={2}>About</Typography.Title>
      <Typography.Paragraph>This is an Electron application built with React, TypeScript, and Ant Design.</Typography.Paragraph>
    </div>
  )
}

export default About
