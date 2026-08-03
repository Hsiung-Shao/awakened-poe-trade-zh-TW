# 換過底材的傳奇 —— 舊版目前解析不出來

交易站有 **76** 個傳奇帶「舊版」條目,
其中 **64** 筆的舊版底材與現行不同。我們的資料集**只收現行那一版**,
所以這些傳奇的**舊版**貼進來會回「解析物品時發生錯誤」。

- 舊版底材我們資料集裡**沒有**的:**0** 筆(補列之前要先補底材)
- 舊版底材台服交易站**搜不到**的:**2** 筆(能解析,但查不到價)

對接鍵全部語言無關:交易站 legacy 條目的 `{name, type}` 兩邊都是英文 refName,
中文名一律從資料集的 refName 反查,沒有做任何文字比對。

| 傳奇 | 現行底材 | 舊版底材(目前解析不出來) | 備註 |
|---|---|---|---|
| 亡者之息<br>`Dying Breath` | 鐵鍛長杖<br>`Iron Staff` | 強化長杖<br>`Coiled Staff` |  |
| 孔明的神算<br>`Kongming's Stratagem` | 遠古魔盾<br>`Ancient Spirit Shield` | 象牙魔盾<br>`Ivory Spirit Shield` |  |
| 日落破滅<br>`Duskblight` | 鐵影長靴<br>`Ironscale Boots` | 粗鱗皮靴<br>`Leatherscale Boots` |  |
| 古典冥約<br>`Relic of the Pact` | 賢者法杖<br>`Sage Wand` | 螺紋法杖<br>`Spiraled Wand` |  |
| 囚神杵<br>`Pillar of the Caged God` | 鐵鍛長杖<br>`Iron Staff` | 長杖<br>`Long Staff` |  |
| 瓦爾之序<br>`Story of the Vaal` | 寶石之劍<br>`Gemstone Sword` | 碧銅短劍<br>`Variscite Blade` |  |
| 皮斯卡托的慧眼<br>`Piscator's Vigil` | 動能魔杖<br>`Kinetic Wand` | 魔性法杖<br>`Imbued Wand` |  |
| 皮斯卡托的慧眼<br>`Piscator's Vigil` | 動能魔杖<br>`Kinetic Wand` | 狂風法杖<br>`Tornado Wand` |  |
| 冰靈之吼<br>`Asphyxia's Wrath` | 羽翼箭袋<br>`Feathered Arrow Quiver` | 雙鋒箭袋<br>`Two-Point Arrow Quiver` |  |
| 多里亞尼的幻想<br>`Doryani's Delusion` | 海獸脛甲 / 絲絨長靴 / 術士長靴<br>`Leviathan Greaves / Velour Boots / Warlock Boots` | 迷蹤短靴<br>`Slink Boots` |  |
| 多里亞尼的幻想<br>`Doryani's Delusion` | 海獸脛甲 / 絲絨長靴 / 術士長靴<br>`Leviathan Greaves / Velour Boots / Warlock Boots` | 術士長靴<br>`Sorcerer Boots` |  |
| 多里亞尼的幻想<br>`Doryani's Delusion` | 海獸脛甲 / 絲絨長靴 / 術士長靴<br>`Leviathan Greaves / Velour Boots / Warlock Boots` | 巨人脛甲<br>`Titan Greaves` |  |
| 宇蝕<br>`Eclipse Solaris` | 獸角法杖<br>`Faun's Horn` | 符文法杖<br>`Engraved Wand` |  |
| 宇蝕<br>`Eclipse Solaris` | 獸角法杖<br>`Faun's Horn` | 水晶法杖<br>`Crystal Wand` |  |
| 托沃臥<br>`Tulfall` | 靈石法杖<br>`Opal Wand` | 狂風法杖<br>`Tornado Wand` |  |
| 托沃崩<br>`Tulborn` | 靈石法杖<br>`Opal Wand` | 螺紋法杖<br>`Spiraled Wand` |  |
| 灰燼行者<br>`Ashcaller` | 羊角法杖<br>`Goat's Horn` | 粗紋法杖<br>`Carved Wand` |  |
| 灰燼行者<br>`Ashcaller` | 羊角法杖<br>`Goat's Horn` | 石英法杖<br>`Quartz Wand` |  |
| 自然組織<br>`Natural Hierarchy` | 雛鳥魔符<br>`Rhex Talisman` | 死羽魔符<br>`Rotfeather Talisman` |  |
| 艾許之鏡<br>`Esh's Mirror` | 瓦爾魔盾<br>`Vaal Spirit Shield` | 暗金魔盾<br>`Thorium Spirit Shield` |  |
| 艾普之怒<br>`Apep's Rage` | 靈兆法杖<br>`Omen Wand` | 靈石法杖<br>`Opal Wand` |  |
| 艾普之眠<br>`Apep's Slumber` | 瓦爾魔盾<br>`Vaal Spirit Shield` | 遠古魔盾<br>`Ancient Spirit Shield` |  |
| 奉獻之舞<br>`Dance of the Offered` | 禁禮之靴<br>`Carnal Boots` | 縛足長靴<br>`Shackled Boots` |  |
| 抹滅<br>`Obliteration` | 靈兆法杖<br>`Omen Wand` | 魔角法杖<br>`Demon's Horn` |  |
| 抹滅<br>`Obliteration` | 靈兆法杖<br>`Omen Wand` | 魔性法杖<br>`Imbued Wand` |  |
| 泣月<br>`Moonsorrow` | 動能魔杖<br>`Kinetic Wand` | 魔性法杖<br>`Imbued Wand` |  |
| 迎暮<br>`Dusktoe` | 鐵影長靴<br>`Ironscale Boots` | 粗鱗皮靴<br>`Leatherscale Boots` |  |
| 思動之手<br>`Hand of Thought and Motion` | 帝國戰爪<br>`Imperial Claw` | 襲眼鉤<br>`Blinder` |  |
| 枯井<br>`Blightwell` | 盾螯魔符<br>`Shield Crab Talisman` | 咒箍魔符<br>`Clutching Talisman` |  |
| 毒蠍之喚<br>`Scorpion's Call` | 沉頓箭袋<br>`Heavy Arrow Quiver` | 寬矢箭袋<br>`Broadhead Arrow Quiver` |  |
| 相生相剋<br>`Allelopathy` | 緞布手套<br>`Satin Gloves` | 術者手套<br>`Sorcerer Gloves` |  |
| 冥約<br>`Midnight Bargain` | 呼喚法杖<br>`Calling Wand` | 符文法杖<br>`Engraved Wand` |  |
| 峽灣之星<br>`Twyzel` | 爆裂魔杖<br>`Blasting Wand` | 賢者法杖<br>`Sage Wand` |  |
| 烏爾尼多之吻<br>`Uul-Netol's Kiss` | 瓦爾巨斧<br>`Vaal Axe` | 雙影巨斧<br>`Labrys` |  |
| 狼煙<br>`The Signal Fire` | 熾熱箭袋<br>`Blazing Arrow Quiver` | 火焰箭袋<br>`Cured Quiver` | ⚠ 台服交易站無此底材 |
| 狼煙<br>`The Signal Fire` | 熾熱箭袋<br>`Blazing Arrow Quiver` | 火靈箭袋<br>`Fire Arrow Quiver` |  |
| 索伏的始源<br>`Xoph's Inception` | 城塞戰弓<br>`Citadel Bow` | 骨製弓<br>`Bone Bow` |  |
| 荒途<br>`Briskwrap` | 日光皮甲<br>`Sun Leather` | 扣環皮甲<br>`Strapped Leather` |  |
| 馬洛尼的暮光<br>`Maloney's Nightfall` | 邪惡箭袋<br>`Vile Arrow Quiver` | 鈍矢箭袋<br>`Blunt Arrow Quiver` |  |
| 雪盲恩惠<br>`The Snowblind Grace` | 星辰皮甲<br>`Zodiac Leather` | 光耀皮甲<br>`Coronal Leather` |  |
| 寒鋒之衛<br>`Rearguard` | 鈍矢箭袋<br>`Blunt Arrow Quiver` | 寬矢箭袋<br>`Broadhead Arrow Quiver` |  |
| 無形火炬<br>`The Formless Flame` | 皇室堅盔<br>`Royal Burgonet` | 破城之盔<br>`Siege Helmet` |  |
| 無盡之距<br>`The Infinite Pursuit` | 巨人脛甲<br>`Titan Greaves` | 巨靈脛甲<br>`Goliath Greaves` |  |
| 虛眼箭矢<br>`Voidfletcher` | 華麗箭袋<br>`Ornate Quiver` | 穿射箭袋<br>`Penetrating Arrow Quiver` |  |
| 虛眼箭矢<br>`Voidfletcher` | 華麗箭袋<br>`Ornate Quiver` | 始祖箭袋<br>`Primal Arrow Quiver` |  |
| 黑炎之芒<br>`Blackgleam` | 熾熱箭袋<br>`Blazing Arrow Quiver` | 火焰箭袋<br>`Cured Quiver` | ⚠ 台服交易站無此底材 |
| 黑炎之芒<br>`Blackgleam` | 熾熱箭袋<br>`Blazing Arrow Quiver` | 火靈箭袋<br>`Fire Arrow Quiver` |  |
| 亂世之翼<br>`Wings of Entropy` | 艾茲麥巨斧<br>`Ezomyte Axe` | 裂甲巨斧<br>`Sundering Axe` |  |
| 奧術之符<br>`Auxium` | 水晶腰帶<br>`Crystal Belt` | 扣鏈腰帶<br>`Chain Belt` |  |
| 煉獄之心<br>`Infernal Mantle` | 毒蛛絲之袍<br>`Widowsilk Robe` | 秘術長衣<br>`Occultist's Vestment` |  |
| 瑞佛詛咒<br>`Rigwald's Curse` | 狼王魔符<br>`Wolf Alpha Talisman` | 亡爪魔符<br>`Wereclaw Talisman` |  |
| 禁錮暴風<br>`Storm Prison` | 螺紋法杖<br>`Spiraled Wand` | 粗紋法杖<br>`Carved Wand` |  |
| 構築之手<br>`Architect's Hand` | 伏擊護手<br>`Ambush Mitts` | 扣環護手<br>`Strapped Mitts` |  |
| 精華收割器<br>`Essentia Sanguis` | 瓦爾戰爪<br>`Vaal Claw` | 刺眼鉤<br>`Eye Gouger` |  |
| 魂飲化面<br>`Mask of the Spirit Drinker` | 行政者戰冠<br>`Magistrate Crown` | 聖戰之盔<br>`Crusader Helmet` |  |
| 學富之筆<br>`The Poet's Pen` | 軀體魔杖<br>`Somatic Wand` | 粗紋法杖<br>`Carved Wand` |  |
| 熾炎之使<br>`The Searing Touch` | 武術長杖<br>`Lathi` | 長杖<br>`Long Staff` |  |
| 謝默斯的贈禮<br>`Saemus' Gift` | 羽翼箭袋<br>`Feathered Arrow Quiver` | 刺鋒箭袋<br>`Spike-Point Arrow Quiver` |  |
| 鮮血支配<br>`Bloodgrip` | 理石護身符<br>`Marble Amulet` | 珊瑚護身符<br>`Coral Amulet` |  |
| 魔能暴風<br>`Manastorm` | 軟橡魔盾<br>`Lacewood Spirit Shield` | 石化魔盾<br>`Fossilised Spirit Shield` |  |
| 贗品．托沃臥<br>`Replica Tulfall` | 靈石法杖<br>`Opal Wand` | 狂風法杖<br>`Tornado Wand` |  |
| 贗品．相生相剋<br>`Replica Allelopathy` | 緞布手套<br>`Satin Gloves` | 術者手套<br>`Sorcerer Gloves` |  |
| 贗品．冥約<br>`Replica Midnight Bargain` | 呼喚法杖<br>`Calling Wand` | 符文法杖<br>`Engraved Wand` |  |
| 贗品．峽灣之星<br>`Replica Twyzel` | 爆裂魔杖<br>`Blasting Wand` | 賢者法杖<br>`Sage Wand` |  |
