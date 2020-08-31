import { v4 as uuid } from 'uuid'
import { WalletNotFound, IsRequired, UsedName, WalletFunctionNotSupported } from 'exceptions'
import Store from 'models/store'
import Keystore from 'models/keys/keystore'
import WalletDeletedSubject from 'models/subjects/wallet-deleted-subject'
import { WalletListSubject, CurrentWalletSubject } from 'models/subjects/wallets'
import { AccountExtendedPublicKey, DefaultAddressNumber } from 'models/keys/key'
import { Address as AddressInterface } from "models/address"

import FileService from './file'
import AddressService from './addresses'
import ProcessUtils from 'utils/process'
import { ChildProcess } from 'utils/worker'
import { AddressType } from 'models/keys/address'

const fileService = FileService.getInstance()

const MODULE_NAME = 'wallets'

export interface DeviceProperties {
  name: string
  publicKey: string
  addressIndex: number
  addressType: AddressType
}

export interface WalletProperties {
  id: string
  name: string
  extendedKey?: string // Serialized account extended public key
  keystore?: Keystore
  device?: DeviceProperties
}

export abstract class Wallet {
  public id: string
  public name: string
  protected extendedKey: string | undefined
  protected device: DeviceProperties | undefined

  constructor(props: WalletProperties) {
    const { id, name, extendedKey, device } = props

    if (id === undefined) {
      throw new IsRequired('ID')
    }
    if (name === undefined) {
      throw new IsRequired('Name')
    }

    if (!extendedKey && !device) {
      throw new IsRequired('Extended Public Key or Device Info')
    }

    this.id = id
    this.name = name
    this.extendedKey = extendedKey
    this.device = device
  }

  public toJSON = () => ({
    id: this.id,
    name: this.name,
    extendedKey: this.extendedKey,
    device: this.device
  })

  public fromJSON = () => {
    throw new Error('not implemented')
  }

  public isHardware = (): boolean => {
    throw new Error('not implemented')
  }

  public loadKeystore = (): Keystore => {
    throw new WalletFunctionNotSupported(this.loadKeystore.name)
  }

  public saveKeystore = (_keystore: Keystore): void => {
    throw new WalletFunctionNotSupported(this.saveKeystore.name)
  }

  public deleteKeystore = (): void => {
    throw new WalletFunctionNotSupported(this.deleteKeystore.name)
  }

  public getDeviceInfo = (): DeviceProperties => {
    throw new WalletFunctionNotSupported(this.getDeviceInfo.name)
  }

  public accountExtendedPublicKey = (): AccountExtendedPublicKey => {
    throw new WalletFunctionNotSupported(this.accountExtendedPublicKey.name)
  }

  public update = ({ name }: { name: string }) => {
    if (name) {
      this.name = name
    }
  }

  public checkAndGenerateAddresses = async (
    _isImporting: boolean = false,
    _receivingAddressCount: number = DefaultAddressNumber.Receiving,
    _changeAddressCount: number = DefaultAddressNumber.Change
  ): Promise<AddressInterface[] | undefined> => {
    throw new Error('not implemented')
  }

  public getNextAddressByWalletId = async (): Promise<AddressInterface | undefined> => {
    throw new Error('not implemented')
  }

  public getNextChangeAddressByWalletId = async (): Promise<AddressInterface | undefined> => {
    throw new Error('not implemented')
  }

  public getNextReceivingAddressesByWalletId = async (): Promise<AddressInterface[]> => {
    throw new Error('not implemented')
  }
}

export class FileKeystoreWallet extends Wallet {
  public isHardware = (): boolean => {
    return false
  }

  public accountExtendedPublicKey = (): AccountExtendedPublicKey => {
    return AccountExtendedPublicKey.parse(this.extendedKey!) as AccountExtendedPublicKey
  }

  public loadKeystore = () => {
    const data = fileService.readFileSync(MODULE_NAME, this.keystoreFileName())
    return Keystore.fromJson(data)
  }

  static fromJSON = (json: WalletProperties) => {
    return new FileKeystoreWallet(json)
  }

  public saveKeystore = (keystore: Keystore): void => {
    fileService.writeFileSync(MODULE_NAME, this.keystoreFileName(), JSON.stringify({ ...keystore, id: this.id }))
  }

  deleteKeystore = () => {
    fileService.deleteFileSync(MODULE_NAME, this.keystoreFileName())
  }

  keystoreFileName = () => {
    return `${this.id}.json`
  }

  public checkAndGenerateAddresses = async (
    isImporting: boolean = false,
    receivingAddressCount: number = DefaultAddressNumber.Receiving,
    changeAddressCount: number = DefaultAddressNumber.Change
  ): Promise<AddressInterface[] | undefined> => {
      return await AddressService.generateAndSaveForExtendedKey(
        this.id,
        this.accountExtendedPublicKey(),
        isImporting,
        receivingAddressCount,
        changeAddressCount
      )
  }

  public getNextAddressByWalletId = async (): Promise<AddressInterface | undefined> => {
    return AddressService.getNextUnusedAddressByWalletId(this.id)
  }

  public getNextChangeAddressByWalletId = async (): Promise<AddressInterface | undefined> => {
    return AddressService.getNextUnusedChangeAddressByWalletId(this.id)
  }

  public getNextReceivingAddressesByWalletId = async (): Promise<AddressInterface[]> => {
    return AddressService.getUnusedReceivingAddressesByWalletId(this.id)
  }
}

export class HardwareWallet extends Wallet {
  public isHardware = (): boolean => {
    return true
  }

  static fromJSON = (json: WalletProperties) => {
    return new HardwareWallet(json)
  }

  public getDeviceInfo = (): DeviceProperties => {
    return this.device!
  }

  public checkAndGenerateAddresses = async (): Promise<AddressInterface[] | undefined> => {
    const {publicKey, addressType, addressIndex} = this.getDeviceInfo()
    const address = await AddressService.generateAndSaveForPublicKey(
      this.id,
      publicKey,
      addressType,
      addressIndex
    )

    if (address) {
      return [address]
    }
  }

  public getNextAddressByWalletId = async (): Promise<AddressInterface | undefined> => {
    return AddressService.getFirstAddressByWalletId(this.id)
  }

  public getNextChangeAddressByWalletId = async (): Promise<AddressInterface | undefined> => {
    return AddressService.getFirstAddressByWalletId(this.id)
  }

  public getNextReceivingAddressesByWalletId = async (): Promise<AddressInterface[]> => {
    const address = await AddressService.getFirstAddressByWalletId(this.id)
    if (address) {
      return [address]
    }

    return []
  }
}

export default class WalletService {
  private static instance: WalletService
  private listStore: Store // Save wallets (meta info except keystore, which is persisted separately)
  private walletsKey = 'wallets'
  private currentWalletKey = 'current'

  public static getInstance = () => {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService()
    }
    return WalletService.instance
  }

  constructor() {
    this.listStore = new Store(MODULE_NAME, 'wallets.json')

    this.listStore.on(
      this.walletsKey,
      (previousWalletList: WalletProperties[] = [], currentWalletList: WalletProperties[] = []) => {
        if (ProcessUtils.isMain()) {
          const currentWallet = this.getCurrent()
          WalletListSubject.next({ currentWallet, previousWalletList, currentWalletList })
        }
      }
    )
    this.listStore.on(this.currentWalletKey, (_prevId: string | undefined, currentID: string | undefined) => {
      if (undefined === currentID) {
        return
      }
      if (ProcessUtils.isMain()) {
        const currentWallet = this.getCurrent() || null
        const walletList = this.getAll()
        CurrentWalletSubject.next({
          currentWallet,
          walletList,
        })
      }
    })
  }

  private fromJSON(json: WalletProperties) {
    if (json.device) {
      return HardwareWallet.fromJSON(json)
    }
    else {
      return FileKeystoreWallet.fromJSON(json)
    }
  }

  public getAll = (): WalletProperties[] => {
    return this.listStore.readSync(this.walletsKey) || []
  }

  public get = (id: string): Wallet => {
    if (id === undefined) {
      throw new IsRequired('ID')
    }

    const wallet = this.getAll().find(w => w.id === id)
    if (!wallet) {
      throw new WalletNotFound(id)
    }

    return this.fromJSON(wallet)
  }

  public generateAddressesIfNecessary = async () => {
    for (const { id } of this.getAll()) {
      const wallet = this.get(id)
      if ((await AddressService.getAddressesByWalletId(wallet.id)).length === 0) {
        await wallet.checkAndGenerateAddresses()
      }
    }
  }

  public create = (props: WalletProperties) => {
    if (!props) {
      throw new IsRequired('wallet property')
    }

    const index = this.getAll().findIndex(wallet => wallet.name === props.name)

    if (index !== -1) {
      throw new UsedName('Wallet')
    }

    const wallet = this.fromJSON({ ...props, id: uuid() })

    if (!wallet.isHardware()) {
      wallet.saveKeystore(props.keystore!)
    }

    this.listStore.writeSync(this.walletsKey, [...this.getAll(), wallet.toJSON()])

    this.setCurrent(wallet.id)
    return wallet
  }

  public update = (id: string, props: Omit<WalletProperties, 'id' | 'extendedKey'>) => {
    const wallets = this.getAll()
    const index = wallets.findIndex((w: WalletProperties) => w.id === id)
    if (index === -1) {
      throw new WalletNotFound(id)
    }

    const wallet = this.fromJSON(wallets[index])

    if (wallet.name !== props.name && wallets.findIndex(storeWallet => storeWallet.name === props.name) !== -1) {
      throw new UsedName('Wallet')
    }

    wallet.update(props)

    if (props.keystore) {
      wallet.saveKeystore(props.keystore)
    }
    wallets[index] = wallet.toJSON()
    this.listStore.writeSync(this.walletsKey, wallets)
  }

  public delete = async (id: string) => {
    const wallets = this.getAll()
    const walletJSON = wallets.find(w => w.id === id)

    if (!walletJSON) {
      throw new WalletNotFound(id)
    }

    const wallet = this.fromJSON(walletJSON)
    const newWallets = wallets.filter(w => w.id !== id)

    const current = this.getCurrent()
    const currentID = current ? current.id : ''

    if (currentID === id) {
      if (newWallets.length > 0) {
        this.setCurrent(newWallets[0].id)
      } else {
        this.setCurrent('')
      }
    }

    this.listStore.writeSync(this.walletsKey, newWallets)

    if (!wallet.isHardware()) {
      wallet.deleteKeystore()
    }
    await AddressService.deleteByWalletId(id)

    if (ChildProcess.isChildProcess()) {
      ChildProcess.send({
        channel: 'wallet-deleted',
        result: id
      })
    } else {
      WalletDeletedSubject.getSubject().next(id)
    }
  }

  public setCurrent = (id: string) => {
    if (id === undefined) {
      throw new IsRequired('ID')
    }

    if (id !== '') {
      const wallet = this.get(id)
      if (!wallet) {
        throw new WalletNotFound(id)
      }
    }

    this.listStore.writeSync(this.currentWalletKey, id)
  }

  public getCurrent = () => {
    const walletId = this.listStore.readSync(this.currentWalletKey) as string
    if (walletId) {
      return this.get(walletId)
    }
    return undefined
  }

  public validate = ({ id, password }: { id: string; password: string }) => {
    const wallet = this.get(id)
    if (!wallet) {
      throw new WalletNotFound(id)
    }

    return wallet.loadKeystore().checkPassword(password)
  }

  public clearAll = () => {
    this.getAll().forEach(w => {
      const wallet = this.fromJSON(w)
      if (!wallet.isHardware()) {
        wallet.deleteKeystore()
      }
    })
    this.listStore.clear()
  }
}
