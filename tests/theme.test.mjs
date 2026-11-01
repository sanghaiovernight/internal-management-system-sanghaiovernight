import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizedTheme,THEME_KEY} from '../lib/theme.ts'
test('theme preference is explicit, defaults to light and never follows an invalid saved value',()=>{
 assert.equal(THEME_KEY,'sanghai_pos_theme');assert.equal(normalizedTheme('dark'),'dark')
 for(const value of [undefined,null,'light','system','DARK','bad'])assert.equal(normalizedTheme(value),'light')
})
