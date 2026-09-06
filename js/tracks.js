(function (root) {
  'use strict';
  const tracks = [
    {
      id: 'coast', name: '晴风海岸', english: 'SUNSHINE COAST', theme: 'coast',
      description: '海风刚好，沿着蓝色海岸全速出发。', difficulty: '轻松入门', level: 1,
      width: 16, sky: '#cceced', fog: '#cfeced', ground: '#aacd82', sand: '#f0dfb1', water: '#65c6cf',
      accent: '#f3834b', dark: '#277575', seed: 12,
      points: [[0, 0], [0, 72], [31, 128], [101, 150], [168, 117], [182, 48], [154, -26], [93, -80], [29, -69], [-12, -35]]
    },
    {
      id: 'desert', name: '沙漠峡谷', english: 'DESERT CANYON', theme: 'desert',
      description: '大漠孤直，峡谷辽阔，把油门踩到底。', difficulty: '宽阔巡航', level: 1,
      width: 18, sky: '#f7e3c2', fog: '#f2ddb8', ground: '#dfa863', sand: '#f2d8a0', water: '#7ec4c0',
      accent: '#d96f3c', dark: '#8a4a2e', seed: 51,
      points: [[0, 0], [0, 95], [15, 150], [70, 168], [120, 140], [135, 95], [180, 80], [220, 45], [215, -15], [165, -45], [105, -30], [55, -65], [0, -55]]
    },
    {
      id: 'forest', name: '青森秘境', english: 'FOREST RUN', theme: 'forest',
      description: '穿过松林和溪谷，把每个弯变成主场。', difficulty: '连续弯道', level: 2,
      width: 14, sky: '#d2e5d8', fog: '#cfdfcf', ground: '#699b72', sand: '#c8b797', water: '#77b6b4',
      accent: '#388675', dark: '#25584b', seed: 37,
      points: [[0, 0], [0, 68], [35, 111], [87, 92], [97, 43], [153, 46], [180, 103], [230, 112], [256, 49], [222, -22], [159, -62], [99, -35], [48, -81], [0, -61]]
    },
    {
      id: 'snow', name: '雪山冰湖', english: 'FROSTPEAK LAKE', theme: 'snow',
      description: '冰湖如镜，发卡弯连着发卡弯，稳住别滑。', difficulty: '冰湖发卡', level: 2,
      width: 13, sky: '#dcebf4', fog: '#d8e8f2', ground: '#e8f1f5', sand: '#f4efe2', water: '#9fd2e8',
      accent: '#5b9ec4', dark: '#3a6b8a', seed: 64,
      points: [[0, 0], [0, 66], [10, 112], [50, 136], [96, 112], [128, 142], [170, 114], [202, 144], [240, 120], [262, 72], [248, 24], [262, -28], [218, -56], [162, -44], [110, -64], [60, -50], [4, -58]]
    },
    {
      id: 'city', name: '落日街区', english: 'SUNSET DISTRICT', theme: 'city',
      description: '城市染上落日，发夹弯等你漂亮甩尾。', difficulty: '高手挑战', level: 3,
      width: 14, sky: '#f3d4bc', fog: '#f0d4bc', ground: '#c5bfb0', sand: '#e4d5bf', water: '#abbec8',
      accent: '#ba715d', dark: '#795747', seed: 86,
      points: [[0, 0], [0, 92], [24, 128], [52, 103], [51, 30], [92, 0], [128, 33], [121, 109], [162, 135], [207, 96], [205, -1], [151, -58], [63, -83], [2, -59]]
    },
    {
      id: 'neon', name: '霓虹夜城', english: 'NEON NIGHT CITY', theme: 'neon',
      description: '夜幕降临，霓虹亮起，弯道快得像光。', difficulty: '夜幕狂飙', level: 3,
      width: 14, sky: '#1a1f3a', fog: '#232a4a', ground: '#3a3f5c', sand: '#565b78', water: '#2c3467',
      accent: '#f554c0', dark: '#10142a', seed: 77,
      points: [[0, 0], [0, 118], [71, 195], [177, 207], [271, 165], [330, 83], [319, 0], [248, -47], [153, -73], [71, -83], [0, -65]]
    },
    {
      id: 'sky', name: '云端天路', english: 'SKY HIGHWAY', theme: 'sky',
      description: '云上的路没有护栏外的大地，只有风。', difficulty: '云端险道', level: 3,
      width: 13, sky: '#bcd9f2', fog: '#c6ddf2', ground: '#cfdff0', sand: '#efe6d0', water: '#8fb8dd',
      accent: '#f2a54a', dark: '#4a6f9a', seed: 93,
      points: [[0, 0], [0, 119], [65, 200], [167, 217], [268, 179], [318, 146], [306, 100], [345, 60], [352, 10], [303, -42], [214, -74], [150, -60], [110, -84], [36, -74]]
    },
    {
      id: 'volcano', name: '火山熔岩', english: 'VOLCANO RIFT', theme: 'volcano',
      description: '熔岩在脚边翻涌，最窄的路，最狠的弯。', difficulty: '熔岩试炼', level: 3,
      width: 12, sky: '#d9b08c', fog: '#cfa284', ground: '#5c4a42', sand: '#8a6f5c', water: '#d9562e',
      accent: '#ff7a33', dark: '#3a2c26', seed: 101,
      points: [[0, 0], [0, 62], [23, 92], [18, 131], [55, 152], [92, 131], [84, 90], [121, 68], [160, 80], [176, 115], [158, 154], [117, 148], [111, 193], [150, 222], [195, 209], [220, 164], [207, 123], [246, 92], [238, 37], [201, 6], [148, 21], [119, -14], [80, -37], [33, -53], [0, -45]]
    }
  ];
  root.KartTracks = tracks;
  if (typeof module !== 'undefined' && module.exports) module.exports = tracks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
