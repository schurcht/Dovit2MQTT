export default class Module {

    constructor(moduleName, config, dovit, mqtt) {
        this.moduleName = moduleName;
        this.config = config;
        this.dovit = dovit;
        this.mqtt = mqtt;
    }

}