import React, { useCallback, useState } from 'react'
import { RouteComponentProps } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Button from 'widgets/Button'
import Dropdown from 'widgets/Dropdown'
import styles from './findDevice.module.scss'
import { LocationState, Model, RoutePath } from './common'

const supportedHardwareModels = [
  {
    text: 'Ledger Nano S',
    key: '0',
    data: {
      manufacturer: 'Ledger',
      product: 'Nano S',
    },
  },
  {
    text: 'Ledger Nano X',
    key: '1',
    data: {
      manufacturer: 'Ledger',
      product: 'Nano X',
    },
  },
  {
    text: 'Ledger Blue',
    key: '2',
    data: {
      manufacturer: 'Ledger',
      product: 'Blue',
    },
  },
]

const SelectModel = ({ match, history }: RouteComponentProps<{}, {}, LocationState>) => {
  const [t] = useTranslation()
  const [model, setModel] = useState<Model>(supportedHardwareModels[0] as any)

  const onBack = useCallback(() => {
    history.push(match.url.replace(RoutePath.ImportHardware, ''))
  }, [history, match.url])

  const onNext = useCallback(() => {
    history.push({
      pathname: match.url + RoutePath.DetectDevice,
      state: {
        model,
        entryPath: match.url,
      },
    })
  }, [history, match.url, model])

  const onDropDownChange = useCallback((_, { data }) => {
    setModel(data)
  }, [])

  return (
    <form onSubmit={onNext} className={styles.container}>
      <header className={styles.title}>{t('import-hardware.title.select-model')}</header>
      <section className={styles.main}>
        <Dropdown onChange={onDropDownChange} placeholder="Select Model" options={supportedHardwareModels} />
      </section>
      <footer className={styles.footer}>
        <Button type="cancel" label={t('import-hardware.actions.cancel')} onClick={onBack} />
        <Button
          type="submit"
          label={t('import-hardware.actions.next')}
          onClick={onNext}
          disabled={model === undefined}
        />
      </footer>
    </form>
  )
}

SelectModel.displayName = 'SelectModel'

export default SelectModel
