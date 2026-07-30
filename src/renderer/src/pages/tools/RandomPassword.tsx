import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Typography, InputNumber, Switch, Button, Input, message, Space, Card } from 'antd'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'

function generatePassword(length: number, upper: boolean, lower: boolean, digits: boolean, symbols: boolean): string {
  const chars = [
    upper && 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower && 'abcdefghijklmnopqrstuvwxyz',
    digits && '0123456789',
    symbols && '!@#$%^&*()_+-=[]{}|;:,.<>?',
  ].filter(Boolean).join('')

  if (!chars) return ''

  let password = ''
  for (let i = 0; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)]
  }
  return password
}

function RandomPassword(): React.JSX.Element {
  const { t } = useTranslation()
  const [length, setLength] = useState(16)
  const [useUpper, setUseUpper] = useState(true)
  const [useLower, setUseLower] = useState(true)
  const [useDigits, setUseDigits] = useState(true)
  const [useSymbols, setUseSymbols] = useState(true)
  const [password, setPassword] = useState('')

  const handleGenerate = () => {
    setPassword(generatePassword(length, useUpper, useLower, useDigits, useSymbols))
  }

  const handleCopy = async () => {
    if (!password) return
    try {
      await navigator.clipboard.writeText(password)
      message.success(t('copied'))
    } catch {
      message.error(t('copyFailed'))
    }
  }

  return (
    <div className="max-w-xl">
      <Card>
        <Space direction="vertical" size="middle" className="w-full">
          <div className="flex items-center gap-4 flex-wrap">
            <Typography.Text>{t('passwordLength')}</Typography.Text>
            <InputNumber min={4} max={128} value={length} onChange={v => setLength(v ?? 16)} />
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <Space>
              <Switch checked={useUpper} onChange={setUseUpper} />
              <Typography.Text>{t('uppercase')}</Typography.Text>
            </Space>
            <Space>
              <Switch checked={useLower} onChange={setUseLower} />
              <Typography.Text>{t('lowercase')}</Typography.Text>
            </Space>
            <Space>
              <Switch checked={useDigits} onChange={setUseDigits} />
              <Typography.Text>{t('digits')}</Typography.Text>
            </Space>
            <Space>
              <Switch checked={useSymbols} onChange={setUseSymbols} />
              <Typography.Text>{t('symbols')}</Typography.Text>
            </Space>
          </div>

          <Button type="primary" icon={<ReloadOutlined />} onClick={handleGenerate} size="large">
            {t('generate')}
          </Button>

          {password && (
            <Space direction="vertical" className="w-full">
              <Input.TextArea
                value={password}
                readOnly
                className="font-mono"
                rows={3}
                autoSize={{ minRows: 2, maxRows: 6 }}
              />
              <Button icon={<CopyOutlined />} onClick={handleCopy}>
                {t('copy')}
              </Button>
            </Space>
          )}
        </Space>
      </Card>
    </div>
  )
}

export default RandomPassword
