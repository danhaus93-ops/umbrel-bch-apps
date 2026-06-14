import { Pipe, PipeTransform } from '@angular/core';

// Max indent levels that are visually rendered. True nesting depth is tracked
// uncapped so block matching stays correct for very deeply nested scripts; only
// the left padding is clamped so deep scripts stay readable / don't overflow.
// Depth is emitted as a class (asm-indent-N) rather than an inline style because
// Angular's [innerHTML] sanitizer strips inline style attributes.
const MAX_VISUAL_DEPTH = 10;

@Pipe({
  name: 'asmStyler',
  standalone: false,
})
export class AsmStylerPipe implements PipeTransform {
  transform(asm: string, crop: number = 0): string {
    const instructions = asm.split('OP_');
    let out = '';
    let chars = -3;
    let depth = 0;
    for (const instruction of instructions) {
      if (instruction === '') {
        continue;
      }
      if (crop && chars > crop) {
        break;
      }
      chars += instruction.length + 3;

      const opcode = instruction.split(' ')[0];
      let renderDepth = depth;
      switch (opcode) {
        case 'IF':
        case 'NOTIF':
        case 'BEGIN':
          renderDepth = depth;
          depth += 1;
          break;
        case 'ELSE':
          renderDepth = Math.max(depth - 1, 0);
          break;
        case 'ENDIF':
        case 'UNTIL':
          depth = Math.max(depth - 1, 0);
          renderDepth = depth;
          break;
      }

      const visualDepth = Math.min(renderDepth, MAX_VISUAL_DEPTH);
      out += this.addStyling(instruction, visualDepth);
    }
    return out;
  }

  addStyling(instruction: string, visualDepth: number = 0): string {
    const opcode = instruction.split(' ')[0];
    let style = '';
    switch (opcode) {
      case '0':
      case 'FALSE':
      case 'PUSHBYTES_1':
      case 'PUSHBYTES_2':
      case 'PUSHBYTES_3':
      case 'PUSHBYTES_4':
      case 'PUSHBYTES_5':
      case 'PUSHBYTES_6':
      case 'PUSHBYTES_7':
      case 'PUSHBYTES_8':
      case 'PUSHBYTES_9':
      case 'PUSHBYTES_10':
      case 'PUSHBYTES_11':
      case 'PUSHBYTES_12':
      case 'PUSHBYTES_13':
      case 'PUSHBYTES_14':
      case 'PUSHBYTES_15':
      case 'PUSHBYTES_16':
      case 'PUSHBYTES_17':
      case 'PUSHBYTES_18':
      case 'PUSHBYTES_19':
      case 'PUSHBYTES_20':
      case 'PUSHBYTES_21':
      case 'PUSHBYTES_22':
      case 'PUSHBYTES_23':
      case 'PUSHBYTES_24':
      case 'PUSHBYTES_25':
      case 'PUSHBYTES_26':
      case 'PUSHBYTES_27':
      case 'PUSHBYTES_28':
      case 'PUSHBYTES_29':
      case 'PUSHBYTES_30':
      case 'PUSHBYTES_31':
      case 'PUSHBYTES_32':
      case 'PUSHBYTES_33':
      case 'PUSHBYTES_34':
      case 'PUSHBYTES_35':
      case 'PUSHBYTES_36':
      case 'PUSHBYTES_37':
      case 'PUSHBYTES_38':
      case 'PUSHBYTES_39':
      case 'PUSHBYTES_40':
      case 'PUSHBYTES_41':
      case 'PUSHBYTES_42':
      case 'PUSHBYTES_43':
      case 'PUSHBYTES_44':
      case 'PUSHBYTES_45':
      case 'PUSHBYTES_46':
      case 'PUSHBYTES_47':
      case 'PUSHBYTES_48':
      case 'PUSHBYTES_49':
      case 'PUSHBYTES_50':
      case 'PUSHBYTES_51':
      case 'PUSHBYTES_52':
      case 'PUSHBYTES_53':
      case 'PUSHBYTES_54':
      case 'PUSHBYTES_55':
      case 'PUSHBYTES_56':
      case 'PUSHBYTES_57':
      case 'PUSHBYTES_58':
      case 'PUSHBYTES_59':
      case 'PUSHBYTES_60':
      case 'PUSHBYTES_61':
      case 'PUSHBYTES_62':
      case 'PUSHBYTES_63':
      case 'PUSHBYTES_64':
      case 'PUSHBYTES_65':
      case 'PUSHBYTES_66':
      case 'PUSHBYTES_67':
      case 'PUSHBYTES_68':
      case 'PUSHBYTES_69':
      case 'PUSHBYTES_70':
      case 'PUSHBYTES_71':
      case 'PUSHBYTES_72':
      case 'PUSHBYTES_73':
      case 'PUSHBYTES_74':
      case 'PUSHBYTES_75':
      case 'PUSHDATA1':
      case 'PUSHDATA2':
      case 'PUSHDATA4':
      case 'PUSHNUM_NEG1':
      case 'TRUE':
      case 'PUSHNUM_1':
      case 'PUSHNUM_2':
      case 'PUSHNUM_3':
      case 'PUSHNUM_4':
      case 'PUSHNUM_5':
      case 'PUSHNUM_6':
      case 'PUSHNUM_7':
      case 'PUSHNUM_8':
      case 'PUSHNUM_9':
      case 'PUSHNUM_10':
      case 'PUSHNUM_11':
      case 'PUSHNUM_12':
      case 'PUSHNUM_13':
      case 'PUSHNUM_14':
      case 'PUSHNUM_15':
      case 'PUSHNUM_16':
        style = 'constants';
        break;

      case 'NOP':
      case 'IF':
      case 'NOTIF':
      case 'BEGIN':
      case 'UNTIL':
      case 'ELSE':
      case 'ENDIF':
      case 'VERIFY':
      case 'DEFINE':
      case 'INVOKE':
      case 'RETURN':
      case 'RETURN_186':
      case 'RETURN_187':
      case 'RETURN_188':
      case 'RETURN_189':
      case 'RETURN_190':
      case 'RETURN_191':
      case 'RETURN_212':
      case 'RETURN_213':
      case 'RETURN_214':
      case 'RETURN_215':
      case 'RETURN_216':
      case 'RETURN_217':
      case 'RETURN_218':
      case 'RETURN_219':
      case 'RETURN_220':
      case 'RETURN_221':
      case 'RETURN_222':
      case 'RETURN_223':
      case 'RETURN_224':
      case 'RETURN_225':
      case 'RETURN_226':
      case 'RETURN_227':
      case 'RETURN_228':
      case 'RETURN_229':
      case 'RETURN_230':
      case 'RETURN_231':
      case 'RETURN_232':
      case 'RETURN_233':
      case 'RETURN_234':
      case 'RETURN_235':
      case 'RETURN_236':
      case 'RETURN_237':
      case 'RETURN_238':
      case 'RETURN_239':
      case 'RETURN_240':
      case 'RETURN_241':
      case 'RETURN_242':
      case 'RETURN_243':
      case 'RETURN_244':
      case 'RETURN_245':
      case 'RETURN_246':
      case 'RETURN_247':
      case 'RETURN_248':
      case 'RETURN_249':
      case 'RETURN_250':
      case 'RETURN_251':
      case 'RETURN_252':
      case 'RETURN_253':
      case 'RETURN_254':
      case 'RETURN_255':
        style = 'control';
        break;

      case 'TOALTSTACK':
      case 'FROMALTSTACK':
      case 'IFDUP':
      case 'DEPTH':
      case 'DROP':
      case 'DUP':
      case 'NIP':
      case 'OVER':
      case 'PICK':
      case 'ROLL':
      case 'ROT':
      case 'SWAP':
      case 'TUCK':
      case '2DROP':
      case '2DUP':
      case '3DUP':
      case '2OVER':
      case '2ROT':
      case '2SWAP':
        style = 'stack';
        break;

      case 'CAT':
      case 'SUBSTR':
      case 'NUM2BIN':
      case 'BIN2NUM':
      case 'LEFT':
      case 'RIGHT':
      case 'SIZE':
      case 'REVERSEBYTES':
        style = 'splice';
        break;

      case 'INVERT':
      case 'AND':
      case 'OR':
      case 'XOR':
      case 'EQUAL':
      case 'EQUALVERIFY':
        style = 'logic';
        break;

      case '1ADD':
      case '1SUB':
      case 'LSHIFTNUM':
      case 'RSHIFTNUM':
      case 'NEGATE':
      case 'ABS':
      case 'NOT':
      case '0NOTEQUAL':
      case 'ADD':
      case 'SUB':
      case 'MUL':
      case 'DIV':
      case 'MOD':
      case 'LSHIFTBIN':
      case 'RSHIFTBIN':
      case 'BOOLAND':
      case 'BOOLOR':
      case 'NUMEQUAL':
      case 'NUMEQUALVERIFY':
      case 'NUMNOTEQUAL':
      case 'LESSTHAN':
      case 'GREATERTHAN':
      case 'LESSTHANOREQUAL':
      case 'GREATERTHANOREQUAL':
      case 'MIN':
      case 'MAX':
      case 'WITHIN':
        style = 'arithmetic';
        break;

      case 'RIPEMD160':
      case 'SHA1':
      case 'SHA256':
      case 'HASH160':
      case 'HASH256':
      case 'CODESEPARATOR':
      case 'CHECKSIG':
      case 'CHECKSIGVERIFY':
      case 'CHECKMULTISIG':
      case 'CHECKMULTISIGVERIFY':
      case 'CHECKSIGADD':
      case 'CHECKDATASIG':
      case 'CHECKDATASIGVERIFY':
        style = 'crypto';
        break;

      case 'CLTV':
      case 'CSV':
        style = 'locktime';
        break;

      case 'INPUTINDEX':
      case 'ACTIVEBYTECODE':
      case 'TXVERSION':
      case 'TXINPUTCOUNT':
      case 'TXOUTPUTCOUNT':
      case 'TXLOCKTIME':
      case 'UTXOVALUE':
      case 'UTXOBYTECODE':
      case 'OUTPOINTTXHASH':
      case 'OUTPOINTINDEX':
      case 'INPUTBYTECODE':
      case 'INPUTSEQUENCENUMBER':
      case 'OUTPUTVALUE':
      case 'OUTPUTBYTECODE':
      case 'UTXOTOKENCATEGORY':
      case 'UTXOTOKENCOMMITMENT':
      case 'UTXOTOKENAMOUNT':
      case 'OUTPUTTOKENCATEGORY':
      case 'OUTPUTTOKENCOMMITMENT':
      case 'OUTPUTTOKENAMOUNT':
        style = 'introspection';
        break;

      case 'RESERVED':
      case 'VER':
      case 'VERIF':
      case 'VERNOTIF':
      case 'NOP1':
      case 'NOP4':
      case 'NOP5':
      case 'NOP6':
      case 'NOP7':
      case 'NOP8':
      case 'NOP9':
      case 'NOP10':
        style = 'reserved';
        break;
    }

    let args = instruction.substr(instruction.indexOf(' ') + 1);
    if (args === opcode) {
      args = '';
    }
    return `<div class='asm-line asm-indent-${visualDepth}'><span class='${style}'>OP_${opcode}</span> ${args}</div>`;
  }
}
