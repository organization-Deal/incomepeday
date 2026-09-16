import { DurableObject } from 'cloudflare:workers';
import { CemSessionCore } from './cem-session-core.js';
export { default } from './index.js';

export class CemSession extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.session=new CemSessionCore(ctx.storage,env);}
  async readBatch(month,batch){return this.session.readBatch(month,batch);}
  async history(data,code){return this.session.history(data,code);}
}
