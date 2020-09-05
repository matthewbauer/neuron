import { Hardware, DeviceInfo, HardwareResponse } from './index'
// import { AccountExtendedPublicKey } from 'models/keys/key'
import HID from '@ledgerhq/hw-transport-node-hid'
import type { DescriptorEvent, Descriptor } from '@ledgerhq/hw-transport'
import type Transport from '@ledgerhq/hw-transport'
import { Observable, timer } from 'rxjs'
import { takeUntil, filter, scan } from 'rxjs/operators'
import Bluetooth from '@ledgerhq/hw-transport-node-ble'
import LedgerCKB from 'hw-app-ckb'
import Transaction from 'models/chain/transaction'
import NodeService from 'services/node'
import { AccountExtendedPublicKey } from 'models/keys/key'
import { AddressType } from 'models/keys/address'
import { ResponseCode } from 'utils/const'

export default class Ledger implements Hardware {
  public deviceInfo: DeviceInfo
  private ledgerCKB: LedgerCKB | null = null
  private transport: Transport | null = null
  public isConnected = false

  constructor (deviceInfo: DeviceInfo) {
    this.deviceInfo = deviceInfo
  }

  public async connect (deviceInfo?: DeviceInfo) {
    if (this.isConnected) {
      return
    }

    this.deviceInfo = deviceInfo ?? this.deviceInfo
    this.transport = this.deviceInfo.isBluetooth
      ? await Bluetooth.open(this.deviceInfo.descriptor)
      : await HID.open(this.deviceInfo.descriptor)

    this.ledgerCKB = new LedgerCKB(this.transport)
    this.isConnected = true
  }

  public async disconect () {
    if (!this.isConnected) {
      return
    }

    this.transport?.close()
    if (this.deviceInfo.isBluetooth) {
      await Bluetooth.disconnect(this.deviceInfo.descriptor)
    }
    this.isConnected = false
  }

  public async getExtendedPublicKey () {
    const { public_key, chain_code } = await this.ledgerCKB!.getWalletExtendedPublicKey(AccountExtendedPublicKey.ckbAccountPath)
    return {
      publicKey: public_key,
      chainCode: chain_code
    }
  }

  public async signTransaction (_: string, tx: Transaction) {
    const { ckb } = NodeService.getInstance()
    const rawTx = ckb.rpc.paramsFormatter.toRawTransaction(tx.toSDKRawTransaction())
    rawTx.witnesses = rawTx.inputs.map(() => '0x')
    rawTx.witnesses[0] = ckb.utils.serializeWitnessArgs({
      lock: '',
      inputType: '',
      outputType: ''
    })
    // const { addressIndex, addressType } = this.deviceInfo
    const txs = await Promise.all(rawTx.inputs.map(i => ckb.rpc.getTransaction(i.previous_output!.tx_hash)))
    const txContext = txs.map(i => ckb.rpc.paramsFormatter.toRawTransaction(i.transaction))

    const signature = await this.ledgerCKB!.signTransaction(
      AccountExtendedPublicKey.ckbAccountPath,
      rawTx,
      rawTx.witnesses,
      txContext,
      AccountExtendedPublicKey.ckbAccountPath,
    )

    tx.witnesses[0] = ckb.utils.serializeWitnessArgs({
      lock: '0x' + signature,
      inputType: '',
      outputType: ''
    })

    tx.hash = tx.computeHash()

    return tx
  }

  async getAppVersion (): Promise<HardwareResponse<string>> {
    try {
      const conf = await this.ledgerCKB?.getAppConfiguration()
      return {
        status: ResponseCode.Success,
        result: conf!.version
      }
    } catch (error) {
      return {
        status: ResponseCode.Fail,
        message: error
      }
    }
  }

  async getFirmwareVersion (): Promise<HardwareResponse<string>> {
    let res: Buffer
    try {
      res = await this.transport!.send(0xe0, 0x01, 0x00, 0x00)!
    } catch (error) {
      return {
        status: ResponseCode.Fail,
        message: error
      }
    }
    const byteArray = [...res]
    const data = byteArray.slice(0, byteArray.length - 2)
    const versionLength = data[4]
    const version = Buffer.from(data.slice(5, 5 + versionLength)).toString()

    return {
      status: ResponseCode.Success,
      result: version
    }
  }

  public static async findDevices () {
    const devices = await Promise.all([
      Ledger.searchDevices(HID.listen, false),
      Ledger.searchDevices(Bluetooth.listen, true)
    ])

    return devices.flat()
  }

  private static async searchDevices (listener: any, isBluetooth: boolean) {
    return new Observable(listener)
      .pipe(
        // searching for 2 seconds
        takeUntil(timer(2000)),
        filter<DescriptorEvent<Descriptor>>(e => e.type === 'add'),
        scan<DescriptorEvent<Descriptor>, DeviceInfo[]>((acc, e) => {
            return [
              ...acc,
              {
                isBluetooth,
                descriptor: e.descriptor,
                vendorId: e.device.vendorId,
                manufacturer: e.device.manufacturer,
                product: e.device.product,
                addressIndex: 0,
                addressType: AddressType.Receiving
              }
            ]
          }, []),
        )
      .toPromise()
  }
}