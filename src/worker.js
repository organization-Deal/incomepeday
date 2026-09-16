import {OnlineTimeCore} from './online-time.js';
import {DailyNotesCore} from './daily-notes.js';
import { DurableObject } from 'cloudflare:workers';
import { CemSessionCore } from './cem-session-core.js';
export { default } from './index.js';

export class CemSession extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.session=new CemSessionCore(ctx.storage,env);}
  async readBatch(month,batch){return this.session.readBatch(month,batch);}
  async statusBatch(batch){return this.session.statusBatch(batch);}
  async history(data,code){return this.session.history(data,code);}
}

export class DailyNotes extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.notes=new DailyNotesCore(ctx.storage);}
 async save(value){return this.notes.save(value);}
 async list(date,cursor){return this.notes.list(date,cursor);}
}

export class OnlineTime extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ledger=new OnlineTimeCore(ctx.storage);}
 async record(samples){return this.ledger.record(samples);}
 async day(code,date){return this.ledger.day(code,date);}
}
