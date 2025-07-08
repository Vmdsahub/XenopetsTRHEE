# Otimizações de Performance para Dispositivos Móveis

## 🚀 Resumo das Melhorias Implementadas

Este documento detalha as otimizações específicas implementadas para melhorar significativamente o desempenho do mapa galáctico em dispositivos móveis.

## 📱 Detecção de Dispositivos Móveis

### Implementação

```typescript
const isMobile = useMemo(() => {
  return (
    /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) ||
    (window.innerWidth <= 768 && window.devicePixelRatio > 1)
  );
}, []);
```

### Critérios de Detecção

- **User Agent**: Detecta dispositivos móveis conhecidos
- **Dimensões da Tela**: Largura ≤ 768px com devicePixelRatio > 1
- **Resultado**: Otimizações aplicadas automaticamente em dispositivos móveis

## ⭐ Redução Drástica de Partículas de Estrelas

### Antes vs Depois

| Camada                         | Desktop | Mobile | Redução |
| ------------------------------ | ------- | ------ | ------- |
| **Layer 1** (Deep background)  | 4,000   | 1,200  | -70%    |
| **Layer 2** (Mid background)   | 3,500   | 1,000  | -71%    |
| **Layer 3** (Near background)  | 3,000   | 900    | -70%    |
| **Layer 4** (Close background) | 2,500   | 750    | -70%    |
| **Layer 5** (Cosmic dust)      | 2,000   | 600    | -70%    |
| **Layer 6** (Close dust)       | 1,500   | 400    | -73%    |
| **Layer 7** (Micro stars)      | 2,500   | 750    | -70%    |
| **Layer 8** (Bright accent)    | 800     | 250    | -69%    |

### **Total de Estrelas**

- **Desktop**: ~17,800 estrelas
- **Mobile**: ~5,350 estrelas
- **Redução Total**: ~70%

## 🖥️ Otimizações de WebGL

### WebGL Padrão (Desktop)

```typescript
const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: false,
  powerPreference: "high-performance",
  precision: "highp",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

### WebGL Mobile-Optimized

```typescript
const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: false,
  powerPreference: "default", // Não força high-performance
  precision: "lowp", // Precisão baixa para mobile
  stencil: false,
  depth: false,
  premultipliedAlpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2)); // Mais conservador
```

### Componente Mobile-Optimized

- **MobileOptimizedWebGLStars**: Componente dedicado para mobile
- **Limite de Estrelas**: Máximo 3,000 estrelas independente do input
- **Shaders Simplificados**: Usa PointsMaterial em vez de shaders customizados
- **Animações Reduzidas**: Remove animações complexas de floating
- **Sampling**: Amostra apenas um subconjunto das estrelas

## 🎯 Frame Rate Desbloqueado

### Frame Rate Targeting

```typescript
// FPS desbloqueado para todos os dispositivos
const targetFrameTime = 0; // Unlimited FPS for both mobile and desktop

// No game loop - sem limitação de frames
// FPS uncapped - no frame rate limiting for any device
```

### Benefícios

- **Performance Máxima**: Aproveita toda capacidade do hardware móvel
- **Displays High Refresh**: Suporte completo para telas 90Hz+, 120Hz+, 144Hz+
- **Responsividade**: Input lag mínimo em dispositivos móveis
- **Escalabilidade**: Automaticamente aproveita dispositivos mais potentes

## ✨ Otimizações de Efeitos

### Shooting Stars

- **Desktop**: 15-20s intervalos
- **Mobile**: 40-90s intervalos (muito menos frequente)

### Trail System

- **Pontos de Trail**: Reduzido pela metade no mobile
- **Frequência de Update**: 70ms vs 35ms (50% menos frequente)

### Tamanhos de Estrelas no WebGL

```typescript
// Tamanhos reduzidos no mobile para reduzir overdraw
let sizeMult = 1;
if (star.type === "giant") sizeMult = isMobile ? 2.0 : 3.2;
else if (star.type === "bright") sizeMult = isMobile ? 1.6 : 2.4;

const baseSize = isMobile ? 2.5 : 3.5; // Tamanho base menor
```

## 🔧 Configurações de Renderer

### Desktop

- **Power Preference**: "high-performance"
- **Precision**: "highp"
- **Pixel Ratio**: até 2.0
- **Complex Shaders**: Enabled

### Mobile

- **Power Preference**: "default"
- **Precision**: "lowp" / "mediump"
- **Pixel Ratio**: até 1.2-1.5
- **Simplified Materials**: PointsMaterial

## 📊 Impacto Esperado

### Performance

- **FPS**: Melhoria de 40-60% em dispositivos móveis
- **Estabilidade**: Muito menos quedas de frame rate
- **Responsividade**: Input lag reduzido significativamente

### Recursos do Sistema

- **CPU**: ~70% menos cálculos de partículas
- **GPU**: Overdraw drasticamente reduzido
- **Memory**: ~70% menos objetos na memória
- **Bateria**: Consumo significativamente menor

### Qualidade Visual

- **Mobile**: Mantém qualidade visual aceitável
- **Desktop**: Zero impacto (usa configurações originais)
- **Transição**: Automática baseada na detecção do dispositivo

## 🎮 Monitoramento

### Indicador Visual

```typescript
FPS: {
  fps;
}
{
  isMobile && "(Mobile)";
}
```

### Como Verificar

1. **Chrome DevTools**: Performance tab
2. **about:gpu**: Verificar aceleração de hardware
3. **FPS Counter**: Canto superior esquerdo do jogo

## ⚙️ Configurações Técnicas

### Browser Mobile

- **Hardware Acceleration**: Deve estar habilitado
- **WebGL**: Suporte necessário
- **Canvas 2D GPU**: Recomendado

### Dispositivos Suportados

- **iOS**: iPhone 8+ / iPad Air 2+
- **Android**: Android 7+ com GPU Adreno/Mali/PowerVR
- **Minimum RAM**: 2GB recomendado

## 🚫 Limitação de FPS Completamente Removida

### Desktop

- **FPS**: Completamente desbloqueado
- **Suporte**: 120Hz+, 144Hz+, 240Hz+ monitors

### Mobile

- **FPS**: Completamente desbloqueado
- **Suporte**: 90Hz+, 120Hz+, 144Hz+ displays móveis
- **Performance**: Máximo aproveitamento do hardware móvel

## 🎯 Próximas Otimizações Possíveis

Se ainda for necessário mais performance em dispositivos específicos:

1. **Web Workers**: Mover cálculos para background thread
2. **Instanced Rendering**: Para estrelas similares
3. **Spatial Partitioning**: Quad-tree para culling
4. **Texture Atlasing**: Para sprites
5. **Progressive Enhancement**: Detectar GPU específica e ajustar

## 📱 Teste nos Dispositivos

### Como Testar

1. Abrir o jogo em dispositivo móvel
2. Verificar se aparece "(Mobile)" no FPS counter
3. Observar FPS estável entre 30-45
4. Navegar pelo mapa - deve estar fluido

### Dispositivos Testados

- **iPhone**: iOS 14+
- **Android**: Chrome 90+
- **iPad**: Safari 14+

## 🔍 Debug

### Flags do Chrome Mobile

```
chrome://flags/
- Hardware-accelerated video decode: Enabled
- Use ANGLE: Enabled
- Canvas 2D GPU acceleration: Enabled
```

### Performance Profiling

- **Timeline**: Verificar que GPU tasks dominam
- **Memory**: ~70% menos objects allocated
- **Network**: Sem impacto (otimizações client-side)
