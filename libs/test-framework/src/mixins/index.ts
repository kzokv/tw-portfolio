import { TestAAA } from "../core/TestAAA.js";

export { CoreMixin } from "./CoreMixin.js";
export { ArrangeMixin } from "./ArrangeMixin.js";
export { ActionsMixin } from "./ActionsMixin.js";
export { AssertMixin } from "./AssertMixin.js";

import { ArrangeMixin } from "./ArrangeMixin.js";
import { ActionsMixin } from "./ActionsMixin.js";
import { AssertMixin } from "./AssertMixin.js";

export const BaseArrange = ArrangeMixin(TestAAA);
export const BaseActions = ActionsMixin(TestAAA);
export const BaseAssert = AssertMixin(TestAAA);
