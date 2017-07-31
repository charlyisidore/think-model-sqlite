const helper = require('think-helper');
const {Schema} = require('think-model-abstract');
const Debounce = require('think-debounce');
const Query = require('./query.js');
const Parser = require('./parser.js');

const QUERY = Symbol('think-model-sqlite-query');
const PARSER = Symbol('think-model-sqlite-parser');
const GET_SCHEMA = Symbol('think-model-sqlite-schema');
const debounce = new Debounce();

/**
 * mysql Schema
 */
module.exports = class MysqlSchema extends Schema {
  /**
   * get query instance
   */
  get query() {
    if (this[QUERY]) return this[QUERY];
    this[QUERY] = new Query(this.config);
    return this[QUERY];
  }
  /**
   * get parset instance
   */
  get parser() {
    if (this[PARSER]) return this[PARSER];
    this[PARSER] = new Parser(this.config);
    return this[PARSER];
  }
  _getItemSchemaValidate(fieldData) {
    const validate = {};
    switch (fieldData.tinyType) {
      case 'tinyint':
        validate.int = {min: 0, max: 255};
        break;
      case 'smallint':
        validate.int = {min: fieldData.unsigned ? 0 : -32768, max: 32767};
        break;
      case 'int':
        validate.int = {min: fieldData.unsigned ? 0 : -2147483648, max: 2147483647};
        break;
      // case 'bigint':
      //   validate.int = {min: fieldData.unique ? 0 : -9223372036854775808, max: 9223372036854775807};
      //   break;
      case 'date':
        validate.date = true;
        break;
    };
    return validate;
  }
  _parseItemSchema(item) {
    const fieldData = {
      name: item.name,
      type: item.type,
      required: !!item.notnull,
      default: item.dflt_value || '',
      primary: !!item.pk,
      unique: item.unique,
      autoIncrement: false
    };
    const pos = item.Type.indexOf('(');
    fieldData.tinyType = (pos === -1 ? item.Type : item.Type.slice(0, pos)).toLowerCase();
    if (fieldData.default && fieldData.tinyType.indexOf('int') > -1) {
      fieldData.default = parseInt(fieldData.default);
    }
    if (item.Type.indexOf('unsigned') > -1) {
      fieldData.unsigned = true;
    }
    fieldData.validate = this._getItemSchemaValidate(fieldData);
    return fieldData;
  }
  /**
   * get table schema
   * @param {String} table 
   */
  getSchema(table = this.table) {
    const _getSchema = () => {
      return debounce.debounce(`getTable${table}Schema`, () => {
        table = this.parser.parseKey(table);
        const fieldsPromise = this.query.query(`PRAGMA table_info( ${table} )`);
        const indexesPromise = this.query.query(`PRAGMA INDEX_LIST( ${table} )`).then(list => {
          const indexes = {};
          const promises = list.map(item => {
            if (item.unique) return;
            return this.query.query(`PRAGMA index_info( ${item.name} )`).then(data => {
              data.forEach(item => {
                indexes[item.name] = {unique: true};
              });
            });
          });
          return Promise.all(promises).then(() => indexes);
        });
        return Promise.all([fieldsPromise, indexesPromise]).then(([fields, indexes]) => {
          const ret = {};
          fields.forEach(item => {
            item.unique = indexes[item.name].unique;
            ret[item.name] = this._parseItemSchema(item);
          });
          return helper.extend(ret, this.schema);
        });
      });
    };
    if (this[GET_SCHEMA] && this[GET_SCHEMA][table]) {
      return Promise.resolve(this[GET_SCHEMA][table]);
    }
    return _getSchema().then(data => {
      if (!this[GET_SCHEMA]) {
        this[GET_SCHEMA] = {};
      }
      this[GET_SCHEMA][table] = data;
      return data;
    });
  }
  /**
   * parse type
   * @param {String} tinyType 
   * @param {Mixed} value 
   */
  parseType(tinyType, value) {
    if (tinyType === 'enum' || tinyType === 'set' || tinyType === 'bigint') return value;
    if (tinyType.indexOf('int') > -1) return parseInt(value, 10);
    if (['double', 'float', 'decimal'].indexOf(tinyType) > -1) return parseFloat(value, 10);
    if (tinyType === 'bool') return value ? 1 : 0;
    return value;
  }
};
