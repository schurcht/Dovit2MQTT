export default class Module {

    constructor(moduleName, config, dovit, mqtt) {
        this.moduleName = moduleName;
        this.config = config;
        this.dovit = dovit;
        this.mqtt = mqtt;

        dovit.loadDevices().then(devices => {
            console.log(`---- DEVICES HANDLERS (${this.moduleName}) ---`)
            var inscopeDevices = devices.filter(e => e.functions.find(f => f.function == this.moduleName))
            console.table(inscopeDevices.map(e => { return { zone: e.zone.name, name: e.name } }))
        })
    }

}