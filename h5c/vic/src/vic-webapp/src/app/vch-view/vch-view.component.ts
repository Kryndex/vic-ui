/*
 Copyright 2017 VMware, Inc. All Rights Reserved.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

import {
  CREATE_VCH_WIZARD_URL,
  DATAGRID_REFRESH_EVENT,
  DELETE_VCH_MODAL_ERROR_EVENT,
  DELETE_VCH_MODAL_HEIGHT,
  DELETE_VCH_MODAL_URL,
  DELETE_VCH_MODAL_WIDTH,
  DOCKER_ENGINE_PORT_NOTLS,
  DOCKER_ENGINE_PORT_TLS,
  VIC_ROOT_OBJECT_ID_WITH_NAME,
  VSPHERE_SERVEROBJ_VIEWEXT_KEY,
  VSPHERE_VITREE_HOSTCLUSTERVIEW_KEY,
  VSPHERE_VM_SUMMARY_KEY,
  WIZARD_MODAL_HEIGHT,
  WIZARD_MODAL_WIDTH,
  WS_VCH
} from '../shared/constants';
import {
  Component,
  NgZone,
  OnDestroy,
  OnInit
} from '@angular/core';
import {
  GlobalsService,
  RefreshService,
  Vic18nService
} from '../shared';

import {CreateVchWizardService} from '../create-vch-wizard/create-vch-wizard.service';
import {ExtendedUserSessionService} from '../services/extended-usersession.service';
import {State} from 'clarity-angular';
import {Subscription} from 'rxjs/Subscription';
import {VicVmViewService} from '../services/vm-view.service';
import {VirtualContainerHost} from './vch.model';

@Component({
  selector: 'vic-vch-view',
  styleUrls: ['./vch-view.scss'],
  templateUrl: './vch-view.template.html'
})
export class VicVchViewComponent implements OnInit, OnDestroy {
  public readonly WS_VCH_CONSTANTS = WS_VCH;
  private refreshSubscription: Subscription;
  public isDgLoading = true;
  public vchs: VirtualContainerHost[] = [];
  public error = '';
  public errorObj: {type: string; payload: any};
  public warning = '';
  public currentState: {
    offset: number;
    sorting: string;
    filter: string;
  } = {offset: 0, sorting: 'id,asc', filter: ''};
  public totalVchsCount: number;
  public readonly maxResultCount: number = 10;

  constructor(private zone: NgZone,
              private vmViewService: VicVmViewService,
              private refreshService: RefreshService,
              private globalsService: GlobalsService,
              private sessionService: ExtendedUserSessionService,
              private createWzService: CreateVchWizardService,
              public vicI18n: Vic18nService) {
  }

  ngOnInit() {
    // subscribes to the global refresh event and calls the
    // reloadVchs() method to query the server for new data
    this.refreshSubscription = this.refreshService
      .refreshObservable$.subscribe(() => {
        this.zone.run(() => {
          this.reloadVchs();
        });
      });

    // listens to an observable that gets the updated vchs data
    // from the server, and updates this.vchs
    this.vmViewService.vchs$.subscribe(vchs => {
      this.vchs = vchs;
      this.isDgLoading = false;
      this.totalVchsCount = this.vmViewService.totalVchsCount;
    }, err => {
      this.vchs = [];
    });


    // listens to a message event from an angular app from another iframe
    // this is set up to handle refreshing the datagrid upon successful vch creation
    // and messages from delete vch modal
    // TODO: move the following to a service
    window.addEventListener('message', this.onMessage.bind(this), false);

    // verify the appliance endpoint
    this.checkVicMachineServer();
  }

  checkVicMachineServer() {
    this.createWzService.verifyVicMachineApiEndpoint()
      .subscribe(
        (ip: string) => {
          this.errorObj = null;
        },
        (err: {type: string; payload: any}) => {
          this.errorObj = err;
        }
      );
  }

  ngOnDestroy() {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
    // TODO: move the following to a service
    window.removeEventListener('message', this.onMessage.bind(this));
  }

  /**
   * Builds and returns Docker API endpoint string
   * @param item : VirtualContainerHost instance
   * @return DOCKER_HOST environment variable
   */
  getDockerEndpointString(item: VirtualContainerHost): string {
    return `DOCKER_HOST=${item.vchIp}:${item.isUsingTls ?
      DOCKER_ENGINE_PORT_TLS : DOCKER_ENGINE_PORT_NOTLS}`;
  }

  /**
   * Queries vic-service with the current Datagrid state
   * @param state current Datagrid state
   */
  refreshGrid(state: State) {
    this.currentState.filter = state.filters ? state.filters
      .map(item => item['property'] + '=' + item['value'])
      .join(',') : '';

    if (state.sort) {
      this.currentState.sorting = `${state.sort.by},${state.sort.reverse ? 'desc' : 'asc'}`;
    }

    this.currentState.offset = state.page.from;
    this.reloadVchs();
  }

  /**
   * Calls vm-view service to reload VCHs
   */
  reloadVchs() {
    this.isDgLoading = true;
    this.vmViewService.getVchsData({
      offset: this.currentState.offset,
      maxResultCount: this.maxResultCount,
      sorting: this.currentState.sorting,
      filter: this.currentState.filter
    });
  }

  /**
   * Navigates to an object specified by objectId
   * @param objectId Full vSphere objectId which starts with urn:
   */
  navigateToObject(objectId: string) {
    if (objectId.indexOf('VirtualMachine') > -1) {
      this.globalsService.getWebPlatform().sendNavigationRequest(
        VSPHERE_VM_SUMMARY_KEY, objectId);
    } else {
      window.parent.location.href = '/ui/#?extensionId=' +
        VSPHERE_SERVEROBJ_VIEWEXT_KEY + '&' +
        'objectId=' + objectId + '&' +
        'navigator=' + VSPHERE_VITREE_HOSTCLUSTERVIEW_KEY;
    }
  }

  /**
   * Opens VCH Creation wizard
   */
  launchCreateVchWizard() {
    const webPlatform = this.globalsService.getWebPlatform();
    webPlatform.openModalDialog(
      ' ',
      CREATE_VCH_WIZARD_URL,
      WIZARD_MODAL_WIDTH,
      WIZARD_MODAL_HEIGHT,
      VIC_ROOT_OBJECT_ID_WITH_NAME
    );
  }

  /**
   * Opens VCH delete modal
   */
  deleteVch(vch: VirtualContainerHost) {
    const subscriber = this.vmViewService.containers$.subscribe(containers => {
      if (containers.some(container => container.parentObjectName === vch.name && container.powerState === 'POWERED_ON')) {
        this.warning = 'You must stop all running containers VMs before you can delete the VCH.';
      } else {
        const webPlatform = this.globalsService.getWebPlatform();
        webPlatform.openModalDialog(
          ' ',
          `${DELETE_VCH_MODAL_URL}`,
          DELETE_VCH_MODAL_WIDTH,
          DELETE_VCH_MODAL_HEIGHT,
          vch.id
        );
      }

      subscriber.unsubscribe();
    });

    this.vmViewService.getContainersData({}); // TODO: filter containers for the vch
  }

  /**
   * Window 'message' listener
   * @param event
   */
  onMessage(event: MessageEvent) {
    if (event.origin !== location.protocol + '//' + location.host) {
      return;
    }

    const data: any = event.data;

    if (data.eventType === DELETE_VCH_MODAL_ERROR_EVENT) {
      this.zone.run(() => {
        let payload;
        try {
          payload = JSON.parse(data.payload)
        } catch (e) {}
        this.error = payload.message || 'Error trying to delete the VCH';
      });
    } else if (data.eventType === DATAGRID_REFRESH_EVENT) {
      this.zone.run(() => {
        this.reloadVchs();
      });
    }
  }
}
