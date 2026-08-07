import {
  Component,
  Evse,
  IDeviceModelRepository,
  ILocationRepository,
  Variable,
  Connector,
  StatusNotification,
  StartTransaction,
  Transaction,
} from '@citrineos/data';
import { ILogObj, Logger } from 'tslog';
import { CrudRepository, OCPP2_0_1, OCPP1_6 } from '@citrineos/base';

/**
 * OCPP 1.6 has no chargingState field, so it is derived from the connector status.
 * Statuses absent from this map (Reserved, Unavailable, Faulted) say nothing about
 * energy transfer and therefore leave the current chargingState untouched.
 */
const OCPP16_STATUS_TO_CHARGING_STATE: Partial<
  Record<OCPP1_6.StatusNotificationRequestStatus, OCPP2_0_1.ChargingStateEnumType>
> = {
  [OCPP1_6.StatusNotificationRequestStatus.Charging]: OCPP2_0_1.ChargingStateEnumType.Charging,
  [OCPP1_6.StatusNotificationRequestStatus.SuspendedEV]:
    OCPP2_0_1.ChargingStateEnumType.SuspendedEV,
  [OCPP1_6.StatusNotificationRequestStatus.SuspendedEVSE]:
    OCPP2_0_1.ChargingStateEnumType.SuspendedEVSE,
  [OCPP1_6.StatusNotificationRequestStatus.Preparing]: OCPP2_0_1.ChargingStateEnumType.EVConnected,
  [OCPP1_6.StatusNotificationRequestStatus.Finishing]: OCPP2_0_1.ChargingStateEnumType.EVConnected,
  [OCPP1_6.StatusNotificationRequestStatus.Available]: OCPP2_0_1.ChargingStateEnumType.Idle,
};

export class StatusNotificationService {
  protected _componentRepository: CrudRepository<Component>;
  protected _deviceModelRepository: IDeviceModelRepository;
  protected _locationRepository: ILocationRepository;
  protected _logger: Logger<ILogObj>;

  constructor(
    componentRepository: CrudRepository<Component>,
    deviceModelRepository: IDeviceModelRepository,
    locationRepository: ILocationRepository,
    logger?: Logger<ILogObj>,
  ) {
    this._componentRepository = componentRepository;
    this._deviceModelRepository = deviceModelRepository;
    this._locationRepository = locationRepository;
    this._logger = logger
      ? logger.getSubLogger({ name: this.constructor.name })
      : new Logger<ILogObj>({ name: this.constructor.name });
  }

  /**
   * Stores an internal record of the incoming status, then updates the device model for the updated connector.
   *
   * @param {string} stationId - The Charging Station sending the status notification request
   * @param {StatusNotificationRequest} statusNotificationRequest
   */
  async processStatusNotification(
    tenantId: number,
    stationId: string,
    statusNotificationRequest: OCPP2_0_1.StatusNotificationRequest,
  ) {
    const chargingStation = await this._locationRepository.readChargingStationByStationId(
      tenantId,
      stationId,
    );
    if (chargingStation) {
      const statusNotification = StatusNotification.build({
        tenantId,
        stationId,
        ...statusNotificationRequest,
      });
      await this._locationRepository.addStatusNotificationToChargingStation(
        tenantId,
        stationId,
        statusNotification,
      );
    } else {
      this._logger.warn(
        `Charging station ${stationId} not found. Status notification cannot be associated with a charging station.`,
      );
    }

    const component = await this._componentRepository.readOnlyOneByQuery(tenantId, {
      where: {
        tenantId,
        name: 'Connector',
      },
      include: [
        {
          model: Evse,
          where: {
            id: statusNotificationRequest.evseId,
            connectorId: statusNotificationRequest.connectorId,
          },
        },
        {
          model: Variable,
          where: {
            name: 'AvailabilityState',
          },
        },
      ],
    });
    const variable = component?.variables?.[0];
    if (!component || !variable) {
      this._logger.warn(
        'Missing component or variable for status notification. Status notification cannot be assigned to device model.',
      );
    } else {
      const reportDataType: OCPP2_0_1.ReportDataType = {
        component: component,
        variable: variable,
        variableAttribute: [
          {
            value: statusNotificationRequest.connectorStatus,
          },
        ],
      };
      await this._deviceModelRepository.createOrUpdateDeviceModelByStationId(
        tenantId,
        reportDataType,
        stationId,
        statusNotificationRequest.timestamp,
      );
    }
  }

  async processOcpp16StatusNotification(
    tenantId: number,
    stationId: string,
    statusNotificationRequest: OCPP1_6.StatusNotificationRequest,
  ) {
    const chargingStation = await this._locationRepository.readChargingStationByStationId(
      tenantId,
      stationId,
    );
    if (chargingStation) {
      const statusNotification = StatusNotification.build({
        tenantId,
        ...statusNotificationRequest,
        stationId,
        connectorStatus: statusNotificationRequest.status,
      });
      await this._locationRepository.addStatusNotificationToChargingStation(
        tenantId,
        stationId,
        statusNotification,
      );

      const connector = {
        tenantId,
        connectorId: statusNotificationRequest.connectorId,
        stationId,
        status: statusNotificationRequest.status,
        timestamp: statusNotificationRequest.timestamp
          ? statusNotificationRequest.timestamp
          : new Date().toISOString(),
        errorCode: statusNotificationRequest.errorCode,
        info: statusNotificationRequest.info,
        vendorId: statusNotificationRequest.vendorId,
        vendorErrorCode: statusNotificationRequest.vendorErrorCode,
      } as Connector;
      await this._locationRepository.createOrUpdateConnector(tenantId, connector);

      await this.updateChargingStateFromConnectorStatus(
        tenantId,
        stationId,
        statusNotificationRequest.connectorId,
        statusNotificationRequest.status,
      );
    } else {
      this._logger.warn(
        `Charging station ${stationId} not found. Status notification cannot be associated with a charging station.`,
      );
    }
  }

  /**
   * Mirrors an OCPP 1.6 connector status onto the chargingState of the connector's
   * ongoing transaction, so that it stays in sync with what OCPP 2.0.1 reports natively.
   */
  private async updateChargingStateFromConnectorStatus(
    tenantId: number,
    stationId: string,
    connectorId: number,
    status: OCPP1_6.StatusNotificationRequestStatus,
  ): Promise<void> {
    // connectorId 0 refers to the charge point itself rather than a connector,
    // so it can never map to a transaction.
    if (connectorId === 0) {
      return;
    }

    const chargingState = OCPP16_STATUS_TO_CHARGING_STATE[status];
    if (!chargingState) {
      return;
    }

    try {
      const transaction = await Transaction.findOne({
        where: { tenantId, stationId, isActive: true },
        include: [
          {
            model: StartTransaction,
            required: true,
            include: [{ model: Connector, required: true, where: { connectorId } }],
          },
        ],
        order: [['createdAt', 'DESC']],
      });

      if (!transaction) {
        return;
      }

      if (transaction.chargingState !== chargingState) {
        await transaction.update({ chargingState });
      }
    } catch (error) {
      this._logger.error(
        `Failed to update chargingState for station ${stationId} connector ${connectorId}.`,
        error,
      );
    }
  }
}
